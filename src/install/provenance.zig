const std = @import("std");
const bun = @import("bun");
const string = []const u8;

pub const ProvenanceError = error{
    UnsupportedCIProvider,
    MissingCIEnvironment,
    PublicAccessRequired,
    OutOfMemory,
};

pub const ProvenanceGenerator = struct {
    allocator: std.mem.Allocator,
    ci_name: ?[]const u8,

    pub fn init(allocator: std.mem.Allocator) ProvenanceGenerator {
        return .{
            .allocator = allocator,
            .ci_name = bun.detectCI(),
        };
    }

    pub fn ensureProvenanceGeneration(
        self: *const ProvenanceGenerator,
        access: ?[]const u8,
    ) ProvenanceError!void {
        const ci_name = self.ci_name orelse return ProvenanceError.MissingCIEnvironment;

        if (std.mem.eql(u8, ci_name, "github-actions")) {
            if (bun.getenvZ("ACTIONS_ID_TOKEN_REQUEST_URL") == null) {
                return ProvenanceError.MissingCIEnvironment;
            }
        } else if (std.mem.eql(u8, ci_name, "gitlab-ci")) {
            if (bun.getenvZ("SIGSTORE_ID_TOKEN") == null) {
                return ProvenanceError.MissingCIEnvironment;
            }
        } else {
            return ProvenanceError.UnsupportedCIProvider;
        }

        if (access == null or !std.mem.eql(u8, access.?, "public")) {
            return ProvenanceError.PublicAccessRequired;
        }
    }

    pub fn generateProvenanceBundle(
        self: *const ProvenanceGenerator,
        package_name: string,
        package_version: string,
        integrity_sha512: []const u8,
    ) ProvenanceError![]const u8 {
        const ci_name = self.ci_name orelse return ProvenanceError.MissingCIEnvironment;

        if (std.mem.eql(u8, ci_name, "github-actions")) {
            return self.generateGitHubProvenance(package_name, package_version, integrity_sha512);
        } else if (std.mem.eql(u8, ci_name, "gitlab-ci")) {
            return self.generateGitLabProvenance(package_name, package_version, integrity_sha512);
        } else {
            return ProvenanceError.UnsupportedCIProvider;
        }
    }

    fn generateGitHubProvenance(
        self: *const ProvenanceGenerator,
        package_name: string,
        package_version: string,
        integrity_sha512: []const u8,
    ) ProvenanceError![]const u8 {
        const env = std.process.getEnvMap(self.allocator) catch return ProvenanceError.OutOfMemory;
        defer env.deinit();

        const github_repository = env.get("GITHUB_REPOSITORY") orelse return ProvenanceError.MissingCIEnvironment;
        const github_server_url = env.get("GITHUB_SERVER_URL") orelse "https://github.com";
        const github_workflow_ref = env.get("GITHUB_WORKFLOW_REF") orelse return ProvenanceError.MissingCIEnvironment;
        const github_ref = env.get("GITHUB_REF") orelse return ProvenanceError.MissingCIEnvironment;
        const github_sha = env.get("GITHUB_SHA") orelse return ProvenanceError.MissingCIEnvironment;
        const github_event_name = env.get("GITHUB_EVENT_NAME") orelse return ProvenanceError.MissingCIEnvironment;
        const github_repository_id = env.get("GITHUB_REPOSITORY_ID") orelse return ProvenanceError.MissingCIEnvironment;
        const github_repository_owner_id = env.get("GITHUB_REPOSITORY_OWNER_ID") orelse return ProvenanceError.MissingCIEnvironment;
        const runner_environment = env.get("RUNNER_ENVIRONMENT") orelse "github-hosted";
        const github_run_id = env.get("GITHUB_RUN_ID") orelse return ProvenanceError.MissingCIEnvironment;
        const github_run_attempt = env.get("GITHUB_RUN_ATTEMPT") orelse "1";

        const relative_ref = if (std.mem.startsWith(u8, github_workflow_ref, github_repository))
            github_workflow_ref[github_repository.len + 1 ..]
        else
            github_workflow_ref;

        const delimiter_index = std.mem.indexOf(u8, relative_ref, "@") orelse return ProvenanceError.MissingCIEnvironment;
        const workflow_path = relative_ref[0..delimiter_index];
        const workflow_ref = relative_ref[delimiter_index + 1 ..];

        const package_url = try std.fmt.allocPrint(self.allocator, "pkg:npm/{s}@{s}", .{ package_name, package_version });
        defer self.allocator.free(package_url);

        const bundle_json = try std.fmt.allocPrint(self.allocator,
            \\{{
            \\  "mediaType": "application/vnd.dev.sigstore.bundle+json;version=0.2",
            \\  "verificationMaterial": {{
            \\    "certificate": "placeholder_certificate",
            \\    "tlogEntries": [{{
            \\      "logIndex": "1",
            \\      "logId": {{
            \\        "keyId": "placeholder_key_id"
            \\      }}
            \\    }}]
            \\  }},
            \\  "dsseEnvelope": {{
            \\    "payload": "{s}",
            \\    "signatures": [{{
            \\      "sig": "placeholder_signature"
            \\    }}]
            \\  }}
            \\}}
        , .{try self.createBase64PayloadGitHub(
            package_url,
            integrity_sha512,
            github_server_url,
            github_repository,
            workflow_ref,
            workflow_path,
            github_event_name,
            github_repository_id,
            github_repository_owner_id,
            github_ref,
            github_sha,
            runner_environment,
            github_run_id,
            github_run_attempt,
        )});

        return bundle_json;
    }

    fn generateGitLabProvenance(
        self: *const ProvenanceGenerator,
        package_name: string,
        package_version: string,
        integrity_sha512: []const u8,
    ) ProvenanceError![]const u8 {
        const env = std.process.getEnvMap(self.allocator) catch return ProvenanceError.OutOfMemory;
        defer env.deinit();

        const ci_project_url = env.get("CI_PROJECT_URL") orelse return ProvenanceError.MissingCIEnvironment;
        const ci_commit_sha = env.get("CI_COMMIT_SHA") orelse return ProvenanceError.MissingCIEnvironment;
        const ci_job_name = env.get("CI_JOB_NAME") orelse return ProvenanceError.MissingCIEnvironment;
        const ci_runner_id = env.get("CI_RUNNER_ID") orelse return ProvenanceError.MissingCIEnvironment;
        const ci_job_url = env.get("CI_JOB_URL") orelse return ProvenanceError.MissingCIEnvironment;

        const package_url = try std.fmt.allocPrint(self.allocator, "pkg:npm/{s}@{s}", .{ package_name, package_version });
        defer self.allocator.free(package_url);

        const bundle_json = try std.fmt.allocPrint(self.allocator,
            \\{{
            \\  "mediaType": "application/vnd.dev.sigstore.bundle+json;version=0.2",
            \\  "verificationMaterial": {{
            \\    "certificate": "placeholder_certificate",
            \\    "tlogEntries": [{{
            \\      "logIndex": "1",
            \\      "logId": {{
            \\        "keyId": "placeholder_key_id"
            \\      }}
            \\    }}]
            \\  }},
            \\  "dsseEnvelope": {{
            \\    "payload": "{s}",
            \\    "signatures": [{{
            \\      "sig": "placeholder_signature"
            \\    }}]
            \\  }}
            \\}}
        , .{try self.createBase64PayloadGitLab(
            package_url,
            integrity_sha512,
            ci_project_url,
            ci_commit_sha,
            ci_job_name,
            ci_runner_id,
            ci_job_url,
        )});

        return bundle_json;
    }

    fn createBase64PayloadGitHub(
        self: *const ProvenanceGenerator,
        package_url: string,
        integrity_sha512: string,
        github_server_url: string,
        github_repository: string,
        workflow_ref: string,
        workflow_path: string,
        github_event_name: string,
        github_repository_id: string,
        github_repository_owner_id: string,
        github_ref: string,
        github_sha: string,
        runner_environment: string,
        github_run_id: string,
        github_run_attempt: string,
    ) ProvenanceError![]const u8 {
        const payload_json = try std.fmt.allocPrint(self.allocator,
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
            workflow_ref,
            github_server_url,
            github_repository,
            workflow_path,
            github_event_name,
            github_repository_id,
            github_repository_owner_id,
            github_server_url,
            github_repository,
            github_ref,
            github_sha,
            runner_environment,
            github_server_url,
            github_repository,
            github_run_id,
            github_run_attempt,
        });
        defer self.allocator.free(payload_json);

        const encoded_len = std.base64.standard.Encoder.calcSize(payload_json.len);
        const encoded = try self.allocator.alloc(u8, encoded_len);
        _ = std.base64.standard.Encoder.encode(encoded, payload_json);

        return encoded;
    }

    fn createBase64PayloadGitLab(
        self: *const ProvenanceGenerator,
        package_url: string,
        integrity_sha512: string,
        ci_project_url: string,
        ci_commit_sha: string,
        ci_job_name: string,
        ci_runner_id: string,
        ci_job_url: string,
    ) ProvenanceError![]const u8 {
        const payload_json = try std.fmt.allocPrint(self.allocator,
            \\{{
            \\  "_type": "https://in-toto.io/Statement/v0.1",
            \\  "subject": [{{
            \\    "name": "{s}",
            \\    "digest": {{
            \\      "sha512": "{s}"
            \\    }}
            \\  }}],
            \\  "predicateType": "https://slsa.dev/provenance/v0.2",
            \\  "predicate": {{
            \\    "buildType": "https://github.com/npm/cli/gitlab/v0alpha1",
            \\    "builder": {{
            \\      "id": "{s}/-/runners/{s}"
            \\    }},
            \\    "invocation": {{
            \\      "configSource": {{
            \\        "uri": "git+{s}",
            \\        "digest": {{
            \\          "sha1": "{s}"
            \\        }},
            \\        "entryPoint": "{s}"
            \\      }}
            \\    }},
            \\    "metadata": {{
            \\      "buildInvocationId": "{s}",
            \\      "completeness": {{
            \\        "parameters": true,
            \\        "environment": true,
            \\        "materials": false
            \\      }},
            \\      "reproducible": false
            \\    }},
            \\    "materials": [{{
            \\      "uri": "git+{s}",
            \\      "digest": {{
            \\        "sha1": "{s}"
            \\      }}
            \\    }}]
            \\  }}
            \\}}
        , .{
            package_url,
            integrity_sha512,
            ci_project_url,
            ci_runner_id,
            ci_project_url,
            ci_commit_sha,
            ci_job_name,
            ci_job_url,
            ci_project_url,
            ci_commit_sha,
        });
        defer self.allocator.free(payload_json);

        const encoded_len = std.base64.standard.Encoder.calcSize(payload_json.len);
        const encoded = try self.allocator.alloc(u8, encoded_len);
        _ = std.base64.standard.Encoder.encode(encoded, payload_json);

        return encoded;
    }
};
