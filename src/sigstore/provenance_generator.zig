const std = @import("std");
const bun = @import("bun");
const crypto = @import("bun_crypto.zig");
const oidc = @import("oidc.zig");
const fulcio = @import("fulcio.zig");
const rekor = @import("rekor.zig");
const dsse = @import("dsse.zig");

pub const ProvenanceError = error{
    UnsupportedCIProvider,
    MissingCIEnvironment,
    PublicAccessRequired,
    TokenAcquisitionFailed,
    CertificateRequestFailed,
    SigningFailed,
    TransparencyLogFailed,
    OutOfMemory,
};

/// Sigstore provenance generator
pub const SigstoreProvenanceGenerator = struct {
    allocator: std.mem.Allocator,
    oidc_manager: oidc.OIDCTokenManager,
    fulcio_url: ?[]const u8,
    rekor_url: ?[]const u8,

    pub fn init(
        allocator: std.mem.Allocator,
        fulcio_url: ?[]const u8,
        rekor_url: ?[]const u8,
    ) !SigstoreProvenanceGenerator {
        var oidc_manager = try oidc.createDefaultTokenManager(allocator);
        
        return SigstoreProvenanceGenerator{
            .allocator = allocator,
            .oidc_manager = oidc_manager,
            .fulcio_url = fulcio_url,
            .rekor_url = rekor_url,
        };
    }

    pub fn deinit(self: *SigstoreProvenanceGenerator) void {
        self.oidc_manager.deinit();
    }

    pub fn ensureProvenanceGeneration(self: *SigstoreProvenanceGenerator, access: ?[]const u8) ProvenanceError!void {
        // Check if we're in a supported CI environment
        if (self.oidc_manager.detectProvider() == null) {
            return ProvenanceError.UnsupportedCIProvider;
        }

        // Check access requirements - allow null (default public) or explicit "public"
        if (access) |a| {
            if (!std.mem.eql(u8, a, "public")) {
                return ProvenanceError.PublicAccessRequired;
            }
        }

        // Try to get an OIDC token to validate environment
        var token = self.oidc_manager.getToken() catch return ProvenanceError.MissingCIEnvironment;
        defer token.deinit();
    }

    pub fn generateProvenanceBundle(
        self: *SigstoreProvenanceGenerator,
        package_name: []const u8,
        package_version: []const u8,
        integrity_sha512: []const u8,
    ) ProvenanceError![]const u8 {
        // Step 1: Get OIDC token
        var token = self.oidc_manager.getToken() catch return ProvenanceError.TokenAcquisitionFailed;
        defer token.deinit();

        // Step 2: Parse JWT claims to get identity
        var jwt_parser = oidc.JWTParser.init(self.allocator);
        var claims = jwt_parser.parseToken(token.token) catch return ProvenanceError.TokenAcquisitionFailed;
        defer claims.deinit();

        const subject_email = claims.email orelse claims.sub orelse return ProvenanceError.TokenAcquisitionFailed;

        // Step 3: Generate ephemeral key pair
        var keypair = crypto.EphemeralKeyPair.generate(self.allocator) catch return ProvenanceError.SigningFailed;
        defer keypair.deinit();

        // Step 4: Request certificate from Fulcio
        var cert_chain = fulcio.requestSigningCertificate(
            self.allocator,
            &keypair,
            &token,
            subject_email,
            self.fulcio_url,
        ) catch return ProvenanceError.CertificateRequestFailed;
        defer cert_chain.deinit();

        // Step 5: Generate SLSA provenance payload
        const provenance_payload = try self.generateSLSAProvenance(
            package_name,
            package_version,
            integrity_sha512,
            &claims,
        );
        defer self.allocator.free(provenance_payload);

        // Step 6: Sign the provenance with DSSE
        var dsse_envelope = dsse.signProvenancePayload(
            self.allocator,
            &keypair,
            provenance_payload,
            null, // No keyid needed
        ) catch return ProvenanceError.SigningFailed;
        defer dsse_envelope.deinit();

        // Step 7: Convert DSSE envelope to JSON
        const dsse_json = dsse_envelope.toJSON() catch return ProvenanceError.SigningFailed;
        defer self.allocator.free(dsse_json);

        // Step 8: Submit to Rekor transparency log
        var log_entry = rekor.submitDSSEToRekor(
            self.allocator,
            dsse_json,
            &cert_chain,
            self.rekor_url,
        ) catch return ProvenanceError.TransparencyLogFailed;
        defer log_entry.deinit();

        // Step 9: Create final Sigstore bundle
        return self.createSigstoreBundle(&cert_chain, &dsse_envelope, &log_entry);
    }

    fn generateSLSAProvenance(
        self: *SigstoreProvenanceGenerator,
        package_name: []const u8,
        package_version: []const u8,
        integrity_sha512: []const u8,
        claims: *const oidc.JWTParser.JWTClaims,
    ) ProvenanceError![]const u8 {
        // Detect CI provider and generate appropriate provenance
        const provider_name = self.oidc_manager.detectProvider() orelse return ProvenanceError.UnsupportedCIProvider;

        if (std.mem.eql(u8, provider_name, "github-actions")) {
            return self.generateGitHubProvenance(package_name, package_version, integrity_sha512, claims);
        } else if (std.mem.eql(u8, provider_name, "gitlab-ci")) {
            return self.generateGitLabProvenance(package_name, package_version, integrity_sha512, claims);
        } else {
            return ProvenanceError.UnsupportedCIProvider;
        }
    }

    fn generateGitHubProvenance(
        self: *SigstoreProvenanceGenerator,
        package_name: []const u8,
        package_version: []const u8,
        integrity_sha512: []const u8,
        claims: *const oidc.JWTParser.JWTClaims,
    ) ProvenanceError![]const u8 {
        const repository = claims.repository orelse bun.getenvZ("GITHUB_REPOSITORY") orelse return ProvenanceError.MissingCIEnvironment;
        const workflow = claims.workflow orelse bun.getenvZ("GITHUB_WORKFLOW") orelse return ProvenanceError.MissingCIEnvironment;
        const ref = claims.ref orelse bun.getenvZ("GITHUB_REF") orelse return ProvenanceError.MissingCIEnvironment;
        const sha = claims.sha orelse bun.getenvZ("GITHUB_SHA") orelse return ProvenanceError.MissingCIEnvironment;
        const run_id = claims.run_id orelse bun.getenvZ("GITHUB_RUN_ID") orelse return ProvenanceError.MissingCIEnvironment;
        const run_attempt = claims.run_attempt orelse bun.getenvZ("GITHUB_RUN_ATTEMPT") orelse "1";
        const server_url = bun.getenvZ("GITHUB_SERVER_URL") orelse "https://github.com";
        const workflow_ref = bun.getenvZ("GITHUB_WORKFLOW_REF") orelse return ProvenanceError.MissingCIEnvironment;
        const event_name = bun.getenvZ("GITHUB_EVENT_NAME") orelse return ProvenanceError.MissingCIEnvironment;
        const repository_id = bun.getenvZ("GITHUB_REPOSITORY_ID") orelse return ProvenanceError.MissingCIEnvironment;
        const repository_owner_id = bun.getenvZ("GITHUB_REPOSITORY_OWNER_ID") orelse return ProvenanceError.MissingCIEnvironment;
        const runner_environment = bun.getenvZ("RUNNER_ENVIRONMENT") orelse "github-hosted";

        // Parse workflow reference to extract path and ref
        const relative_ref = if (std.mem.startsWith(u8, workflow_ref, repository))
            workflow_ref[repository.len + 1 ..]
        else
            workflow_ref;

        const delimiter_index = std.mem.indexOf(u8, relative_ref, "@") orelse return ProvenanceError.MissingCIEnvironment;
        const workflow_path = relative_ref[0..delimiter_index];
        const workflow_ref_parsed = relative_ref[delimiter_index + 1 ..];

        const package_url = try std.fmt.allocPrint(self.allocator, "pkg:npm/{s}@{s}", .{ package_name, package_version });
        defer self.allocator.free(package_url);

        return std.fmt.allocPrint(self.allocator,
            \\{{
            \\  "_type": "https://in-toto.io/Statement/v1",
            \\  "subject": [{{
            \\    "name": "{s}",
            \\    "digest": {{
            \\      "sha512": "{s}"
            \\    }}
            \\  }}],
            \\  "predicateType": "https://slsa.dev/provenance/v1",
            \\  "predicate": {{
            \\    "buildDefinition": {{
            \\      "buildType": "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
            \\      "externalParameters": {{
            \\        "workflow": {{
            \\          "ref": "{s}",
            \\          "repository": "{s}/{s}",
            \\          "path": "{s}"
            \\        }}
            \\      }},
            \\      "internalParameters": {{
            \\        "github": {{
            \\          "event_name": "{s}",
            \\          "repository_id": "{s}",
            \\          "repository_owner_id": "{s}"
            \\        }}
            \\      }},
            \\      "resolvedDependencies": [{{
            \\        "uri": "git+{s}/{s}@{s}",
            \\        "digest": {{
            \\          "gitCommit": "{s}"
            \\        }}
            \\      }}]
            \\    }},
            \\    "runDetails": {{
            \\      "builder": {{
            \\        "id": "https://github.com/actions/runner/{s}"
            \\      }},
            \\      "metadata": {{
            \\        "invocationId": "{s}/{s}/actions/runs/{s}/attempts/{s}"
            \\      }}
            \\    }}
            \\  }}
            \\}}
        , .{
            package_url,
            integrity_sha512,
            workflow_ref_parsed,
            server_url,
            repository,
            workflow_path,
            event_name,
            repository_id,
            repository_owner_id,
            server_url,
            repository,
            ref,
            sha,
            runner_environment,
            server_url,
            repository,
            run_id,
            run_attempt,
        });
    }

    fn generateGitLabProvenance(
        self: *SigstoreProvenanceGenerator,
        package_name: []const u8,
        package_version: []const u8,
        integrity_sha512: []const u8,
        claims: *const oidc.JWTParser.JWTClaims,
    ) ProvenanceError![]const u8 {
        const project_path = claims.project_path orelse bun.getenvZ("CI_PROJECT_PATH") orelse return ProvenanceError.MissingCIEnvironment;
        const pipeline_id = claims.pipeline_id orelse bun.getenvZ("CI_PIPELINE_ID") orelse return ProvenanceError.MissingCIEnvironment;
        const job_id = claims.job_id orelse bun.getenvZ("CI_JOB_ID") orelse return ProvenanceError.MissingCIEnvironment;
        const commit_sha = bun.getenvZ("CI_COMMIT_SHA") orelse return ProvenanceError.MissingCIEnvironment;
        const project_url = bun.getenvZ("CI_PROJECT_URL") orelse return ProvenanceError.MissingCIEnvironment;
        const job_url = bun.getenvZ("CI_JOB_URL") orelse return ProvenanceError.MissingCIEnvironment;
        const runner_id = bun.getenvZ("CI_RUNNER_ID") orelse return ProvenanceError.MissingCIEnvironment;

        const package_url = try std.fmt.allocPrint(self.allocator, "pkg:npm/{s}@{s}", .{ package_name, package_version });
        defer self.allocator.free(package_url);

        return std.fmt.allocPrint(self.allocator,
            \\{{
            \\  "_type": "https://in-toto.io/Statement/v1",
            \\  "subject": [{{
            \\    "name": "{s}",
            \\    "digest": {{
            \\      "sha512": "{s}"
            \\    }}
            \\  }}],
            \\  "predicateType": "https://slsa.dev/provenance/v1",
            \\  "predicate": {{
            \\    "buildDefinition": {{
            \\      "buildType": "https://gitlab.com/slsa-framework/slsa-gitlab/-/blob/main/buildtypes/gitlab-ci.md",
            \\      "externalParameters": {{
            \\        "project_path": "{s}",
            \\        "pipeline_id": "{s}",
            \\        "job_id": "{s}"
            \\      }},
            \\      "resolvedDependencies": [{{
            \\        "uri": "git+{s}@{s}",
            \\        "digest": {{
            \\          "gitCommit": "{s}"
            \\        }}
            \\      }}]
            \\    }},
            \\    "runDetails": {{
            \\      "builder": {{
            \\        "id": "https://gitlab.com/{s}"
            \\      }},
            \\      "metadata": {{
            \\        "invocationId": "{s}",
            \\        "runner_id": "{s}"
            \\      }}
            \\    }}
            \\  }}
            \\}}
        , .{
            package_url,
            integrity_sha512,
            project_path,
            pipeline_id,
            job_id,
            project_url,
            commit_sha,
            commit_sha,
            project_path,
            job_url,
            runner_id,
        });
    }

    fn createSigstoreBundle(
        self: *SigstoreProvenanceGenerator,
        cert_chain: *const fulcio.CertificateChain,
        dsse_envelope: *const dsse.Envelope,
        log_entry: *const rekor.LogEntry,
    ) ProvenanceError![]const u8 {
        // Get certificate PEM
        const cert_pem = cert_chain.getSigningCertPEM() catch return ProvenanceError.OutOfMemory;
        defer self.allocator.free(cert_pem);

        // Get DSSE envelope JSON
        const dsse_json = dsse_envelope.toJSON() catch return ProvenanceError.SigningFailed;
        defer self.allocator.free(dsse_json);

        // Escape certificate PEM for JSON
        var escaped_cert = std.ArrayList(u8).init(self.allocator);
        defer escaped_cert.deinit();
        
        for (cert_pem) |c| {
            switch (c) {
                '\n' => try escaped_cert.appendSlice("\\n"),
                '"' => try escaped_cert.appendSlice("\\\""),
                '\\' => try escaped_cert.appendSlice("\\\\"),
                else => try escaped_cert.append(c),
            }
        }

        // Create Sigstore bundle with real data
        return std.fmt.allocPrint(self.allocator,
            \\{{
            \\  "mediaType": "application/vnd.dev.sigstore.bundle+json;version=0.2",
            \\  "verificationMaterial": {{
            \\    "certificate": "{s}",
            \\    "tlogEntries": [{{
            \\      "logIndex": "{d}",
            \\      "logId": {{
            \\        "keyId": "{s}"
            \\      }},
            \\      "kindVersion": {{
            \\        "kind": "dsse",
            \\        "version": "0.0.1"
            \\      }},
            \\      "integratedTime": "{d}",
            \\      "canonicalizedBody": "{s}"
            \\    }}]
            \\  }},
            \\  "dsseEnvelope": {s}
            \\}}
        , .{
            escaped_cert.items,
            log_entry.log_index,
            log_entry.log_id,
            log_entry.integrated_time,
            log_entry.body,
            dsse_json,
        });
    }
};

/// Factory function to create a provenance generator
pub fn createProvenanceGenerator(
    allocator: std.mem.Allocator,
    fulcio_url: ?[]const u8,
    rekor_url: ?[]const u8,
) !SigstoreProvenanceGenerator {
    return SigstoreProvenanceGenerator.init(allocator, fulcio_url, rekor_url);
}