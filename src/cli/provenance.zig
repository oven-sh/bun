/// Provenance generation for `bun publish --provenance`.
///
/// Implements SLSA provenance attestation following the npm provenance spec:
/// 1. Detect CI environment (GitHub Actions / GitLab CI)
/// 2. Fetch OIDC identity token from CI provider
/// 3. Build in-toto SLSA provenance predicate
/// 4. Sign via Sigstore (Fulcio certificate + DSSE envelope)
/// 5. Record in Rekor transparency log
/// 6. Assemble Sigstore bundle for attachment to publish request
pub const Provenance = @This();

pub const CIEnvironment = enum {
    github_actions,
    gitlab_ci,
};

pub const ProvenanceContext = struct {
    ci: CIEnvironment,
    oidc_token: string,
    allocator: std.mem.Allocator,

    // GitHub Actions env vars (populated when ci == .github_actions)
    github: ?GitHubContext = null,

    // GitLab env vars (populated when ci == .gitlab_ci)
    gitlab: ?GitLabContext = null,
};

pub const GitHubContext = struct {
    workflow_ref: string,
    repository: string,
    event_name: string,
    repository_id: string,
    repository_owner_id: string,
    server_url: string,
    ref: string,
    sha: string,
    runner_environment: string,
    run_id: string,
    run_attempt: string,
};

pub const GitLabContext = struct {
    sigstore_id_token: string,
    project_url: string,
    runner_id: string,
    commit_sha: string,
    job_name: string,
    job_id: string,
    job_url: string,
    pipeline_id: string,
    config_path: string,
    server_url: string,
    project_path: string,
    runner_description: string,
    runner_arch: string,

    /// All CI_* and GITLAB_* env vars for the invocation parameters.
    /// npm captures ~80 env vars here; we capture all CI_*/GITLAB_*/RUNNER_* vars.
    env_params: bun.StringArrayHashMapUnmanaged(string),
};

pub const ProvenanceError = error{
    NotInCI,
    UnsupportedCI,
    MissingOIDCEndpoint,
    MissingOIDCToken,
    OIDCRequestFailed,
    OIDCResponseInvalid,
    MissingGitHubEnvVars,
} || OOM;

pub const SigningError = error{
    KeyGenFailed,
    PEMEncodingFailed,
    SigningFailed,
    FulcioRequestFailed,
    FulcioResponseInvalid,
    JWTDecodeFailed,
} || OOM;

/// Detect CI environment and collect OIDC token + metadata.
/// Returns error if --provenance is used outside a supported CI.
pub fn init(allocator: std.mem.Allocator) ProvenanceError!ProvenanceContext {
    const ci_name = bun.ci.detectCIName() orelse {
        return error.NotInCI;
    };

    if (strings.eqlComptime(ci_name, "github-actions")) {
        return initGitHubActions(allocator);
    } else if (strings.eqlComptime(ci_name, "gitlab-ci")) {
        return initGitLabCI(allocator);
    } else {
        return error.UnsupportedCI;
    }
}

fn initGitHubActions(allocator: std.mem.Allocator) ProvenanceError!ProvenanceContext {
    const request_url = bun.getenvZ("ACTIONS_ID_TOKEN_REQUEST_URL") orelse {
        return error.MissingOIDCEndpoint;
    };
    const request_token = bun.getenvZ("ACTIONS_ID_TOKEN_REQUEST_TOKEN") orelse {
        return error.MissingOIDCToken;
    };

    // Collect all required GitHub context env vars
    const github_ctx = GitHubContext{
        .workflow_ref = bun.getenvZ("GITHUB_WORKFLOW_REF") orelse return error.MissingGitHubEnvVars,
        .repository = bun.getenvZ("GITHUB_REPOSITORY") orelse return error.MissingGitHubEnvVars,
        .event_name = bun.getenvZ("GITHUB_EVENT_NAME") orelse return error.MissingGitHubEnvVars,
        .repository_id = bun.getenvZ("GITHUB_REPOSITORY_ID") orelse return error.MissingGitHubEnvVars,
        .repository_owner_id = bun.getenvZ("GITHUB_REPOSITORY_OWNER_ID") orelse return error.MissingGitHubEnvVars,
        .server_url = bun.getenvZ("GITHUB_SERVER_URL") orelse "https://github.com",
        .ref = bun.getenvZ("GITHUB_REF") orelse return error.MissingGitHubEnvVars,
        .sha = bun.getenvZ("GITHUB_SHA") orelse return error.MissingGitHubEnvVars,
        .runner_environment = bun.getenvZ("RUNNER_ENVIRONMENT") orelse "unknown",
        .run_id = bun.getenvZ("GITHUB_RUN_ID") orelse return error.MissingGitHubEnvVars,
        .run_attempt = bun.getenvZ("GITHUB_RUN_ATTEMPT") orelse "1",
    };

    // Fetch OIDC token from GitHub Actions
    const oidc_token = try fetchGitHubOIDCToken(allocator, request_url, request_token);

    return .{
        .ci = .github_actions,
        .oidc_token = oidc_token,
        .allocator = allocator,
        .github = github_ctx,
    };
}

fn initGitLabCI(allocator: std.mem.Allocator) ProvenanceError!ProvenanceContext {
    const id_token = bun.getenvZ("SIGSTORE_ID_TOKEN") orelse {
        return error.MissingOIDCToken;
    };

    // Collect all CI_*, GITLAB_*, and RUNNER_* env vars for invocation parameters
    var env_params: bun.StringArrayHashMapUnmanaged(string) = .{};
    const env_slice = std.os.environ;
    for (env_slice) |entry| {
        const env_entry = std.mem.sliceTo(entry, 0);
        if (std.mem.indexOfScalar(u8, env_entry, '=')) |eq_pos| {
            const key = env_entry[0..eq_pos];
            const value = env_entry[eq_pos + 1 ..];
            if (strings.hasPrefixComptime(key, "CI_") or
                strings.hasPrefixComptime(key, "GITLAB_") or
                strings.hasPrefixComptime(key, "RUNNER_"))
            {
                try env_params.put(allocator, key, value);
            }
        }
    }

    return .{
        .ci = .gitlab_ci,
        .oidc_token = try allocator.dupe(u8, id_token),
        .allocator = allocator,
        .gitlab = .{
            .sigstore_id_token = id_token,
            .project_url = bun.getenvZ("CI_PROJECT_URL") orelse "",
            .runner_id = bun.getenvZ("CI_RUNNER_ID") orelse "",
            .commit_sha = bun.getenvZ("CI_COMMIT_SHA") orelse "",
            .job_name = bun.getenvZ("CI_JOB_NAME") orelse "",
            .job_id = bun.getenvZ("CI_JOB_ID") orelse "",
            .job_url = bun.getenvZ("CI_JOB_URL") orelse "",
            .pipeline_id = bun.getenvZ("CI_PIPELINE_ID") orelse "",
            .config_path = bun.getenvZ("CI_CONFIG_PATH") orelse "",
            .server_url = bun.getenvZ("CI_SERVER_URL") orelse "",
            .project_path = bun.getenvZ("CI_PROJECT_PATH") orelse "",
            .runner_description = bun.getenvZ("CI_RUNNER_DESCRIPTION") orelse "",
            .runner_arch = bun.getenvZ("CI_RUNNER_EXECUTABLE_ARCH") orelse "",
            .env_params = env_params,
        },
    };
}

/// Fetch an OIDC identity token from GitHub Actions.
/// GET {ACTIONS_ID_TOKEN_REQUEST_URL}&audience=sigstore
/// Authorization: Bearer {ACTIONS_ID_TOKEN_REQUEST_TOKEN}
fn fetchGitHubOIDCToken(
    allocator: std.mem.Allocator,
    request_url: string,
    request_token: string,
) ProvenanceError!string {
    // Build URL with audience parameter
    var url_buf = std.ArrayListUnmanaged(u8){};
    defer url_buf.deinit(allocator);
    const url_writer = url_buf.writer(allocator);

    // The request URL may already have query params, so use & not ?
    const separator: u8 = if (strings.indexOfChar(request_url, '?') != null) '&' else '?';
    try url_writer.print("{s}{c}audience=sigstore", .{ request_url, separator });

    const token_url = URL.parse(url_buf.items);

    // Build headers
    var print_buf: std.ArrayListUnmanaged(u8) = .{};
    defer print_buf.deinit(allocator);
    var print_writer = print_buf.writer(allocator);

    var headers: http.HeaderBuilder = .{};

    {
        headers.count("accept", "application/json");

        try print_writer.print("Bearer {s}", .{request_token});
        headers.count("authorization", print_buf.items);
        print_buf.clearRetainingCapacity();
    }

    try headers.allocate(allocator);

    {
        headers.append("accept", "application/json");

        try print_writer.print("Bearer {s}", .{request_token});
        headers.append("authorization", print_buf.items);
        print_buf.clearRetainingCapacity();
    }

    var response_buf = try MutableString.init(allocator, 4096);
    defer response_buf.deinit();

    var req = http.AsyncHTTP.initSync(
        allocator,
        .GET,
        token_url,
        headers.entries,
        headers.content.ptr.?[0..headers.content.len],
        &response_buf,
        "",
        null,
        null,
        .follow,
    );

    const res = req.sendSync() catch |err| {
        switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.OIDCRequestFailed,
        }
    };

    if (res.status_code != 200) {
        return error.OIDCRequestFailed;
    }

    // Parse response: { "value": "<JWT>" }
    const source = logger.Source.initPathString("oidc-token", response_buf.list.items);
    var log = logger.Log.init(allocator);
    defer log.deinit();

    const json = JSON.parseUTF8(&source, &log, allocator) catch {
        return error.OIDCResponseInvalid;
    };

    const token = json.getStringCloned(allocator, "value") catch {
        return error.OutOfMemory;
    } orelse {
        return error.OIDCResponseInvalid;
    };

    return token;
}

/// Subject info for the in-toto statement.
pub const Subject = struct {
    package_name: string,
    package_version: string,
    sha512_hex: string,
};

/// Build the in-toto provenance statement JSON.
/// Returns the JSON bytes that will be signed in the DSSE envelope.
pub fn buildProvenanceStatement(
    ctx: *const ProvenanceContext,
    subject: Subject,
) OOM!string {
    return switch (ctx.ci) {
        .github_actions => try buildGitHubStatement(ctx, subject),
        .gitlab_ci => try buildGitLabStatement(ctx, subject),
    };
}

fn buildGitHubStatement(
    ctx: *const ProvenanceContext,
    subject: Subject,
) OOM!string {
    const gh = ctx.github.?;
    const allocator = ctx.allocator;

    var buf = std.ArrayListUnmanaged(u8){};
    const w = buf.writer(allocator);

    // GITHUB_WORKFLOW_REF format: "owner/repo/.github/workflows/file.yml@refs/heads/main"
    // Split on '@' to get workflow path and ref
    const workflow_path, const workflow_ref = splitWorkflowRef(gh.workflow_ref);

    const purl = try fmtPurl(allocator, subject.package_name, subject.package_version);

    // Comptime keys are inlined directly since they contain no special JSON chars.
    // Dynamic values use writeJsonStringContent to avoid intermediate allocations.
    try w.writeAll(
        \\{"_type":"https://in-toto.io/Statement/v1","subject":[{"name":
    );
    try writeJsonString(w, purl);
    try w.writeAll(
        \\,"digest":{"sha512":
    );
    try writeJsonString(w, subject.sha512_hex);
    try w.writeAll(
        \\}}],"predicateType":"https://slsa.dev/provenance/v1","predicate":{"buildDefinition":{"buildType":"https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1","externalParameters":{"workflow":{"ref":
    );
    try writeJsonString(w, workflow_ref);

    // "repository": "{server_url}/{repository}" — write directly, no allocPrint
    try w.writeAll(
        \\,"repository":"
    );
    try writeJsonStringContent(w, gh.server_url);
    try w.writeByte('/');
    try writeJsonStringContent(w, gh.repository);
    try w.writeAll(
        \\","path":
    );
    try writeJsonString(w, workflow_path);
    try w.writeAll(
        \\}},"internalParameters":{"github":{"event_name":
    );
    try writeJsonString(w, gh.event_name);
    try w.writeAll(
        \\,"repository_id":
    );
    try writeJsonString(w, gh.repository_id);
    try w.writeAll(
        \\,"repository_owner_id":
    );
    try writeJsonString(w, gh.repository_owner_id);

    // "resolvedDependencies" — "uri": "git+{server_url}/{repository}@{ref}"
    try w.writeAll(
        \\}},"resolvedDependencies":[{"uri":"git+
    );
    try writeJsonStringContent(w, gh.server_url);
    try w.writeByte('/');
    try writeJsonStringContent(w, gh.repository);
    try w.writeByte('@');
    try writeJsonStringContent(w, gh.ref);
    try w.writeAll(
        \\","digest":{"gitCommit":
    );
    try writeJsonString(w, gh.sha);

    // "runDetails" — "builder.id": "https://github.com/actions/runner/{runner_env}"
    try w.writeAll(
        \\}}]},"runDetails":{"builder":{"id":"https://github.com/actions/runner/
    );
    try writeJsonStringContent(w, gh.runner_environment);

    // "metadata.invocationId": "{server_url}/{repository}/actions/runs/{run_id}/attempts/{run_attempt}"
    try w.writeAll(
        \\"},"metadata":{"invocationId":"
    );
    try writeJsonStringContent(w, gh.server_url);
    try w.writeByte('/');
    try writeJsonStringContent(w, gh.repository);
    try w.writeAll("/actions/runs/");
    try writeJsonStringContent(w, gh.run_id);
    try w.writeAll("/attempts/");
    try writeJsonStringContent(w, gh.run_attempt);
    try w.writeAll(
        \\"}}}}
    );

    return buf.items;
}

fn buildGitLabStatement(
    ctx: *const ProvenanceContext,
    subject: Subject,
) OOM!string {
    const gl = ctx.gitlab.?;
    const allocator = ctx.allocator;

    var buf = std.ArrayListUnmanaged(u8){};
    const w = buf.writer(allocator);

    const purl = try fmtPurl(allocator, subject.package_name, subject.package_version);

    try w.writeAll("{");

    // "_type"
    try writeJsonString(w, "_type");
    try w.writeByte(':');
    try writeJsonString(w, "https://in-toto.io/Statement/v0.1");
    try w.writeByte(',');

    // "subject"
    try writeJsonString(w, "subject");
    try w.writeAll(":[{");
    try writeJsonString(w, "name");
    try w.writeByte(':');
    try writeJsonString(w, purl);
    try w.writeByte(',');
    try writeJsonString(w, "digest");
    try w.writeAll(":{");
    try writeJsonString(w, "sha512");
    try w.writeByte(':');
    try writeJsonString(w, subject.sha512_hex);
    try w.writeAll("}}],");

    // "predicateType"
    try writeJsonString(w, "predicateType");
    try w.writeByte(':');
    try writeJsonString(w, "https://slsa.dev/provenance/v0.2");
    try w.writeByte(',');

    // "predicate"
    try writeJsonString(w, "predicate");
    try w.writeAll(":{");

    // "buildType"
    try writeJsonString(w, "buildType");
    try w.writeByte(':');
    try writeJsonString(w, "https://github.com/npm/cli/gitlab/v0alpha1");
    try w.writeByte(',');

    // "builder"
    try writeJsonString(w, "builder");
    try w.writeAll(":{");
    try writeJsonString(w, "id");
    try w.writeByte(':');
    try writeJsonString(w, try std.fmt.allocPrint(allocator, "{s}/-/runners/{s}", .{ gl.project_url, gl.runner_id }));
    try w.writeAll("},");

    // "invocation"
    try writeJsonString(w, "invocation");
    try w.writeAll(":{");

    // "configSource"
    try writeJsonString(w, "configSource");
    try w.writeAll(":{");
    try writeJsonString(w, "uri");
    try w.writeByte(':');
    try writeJsonString(w, try std.fmt.allocPrint(allocator, "git+{s}", .{gl.project_url}));
    try w.writeByte(',');
    try writeJsonString(w, "digest");
    try w.writeAll(":{");
    try writeJsonString(w, "sha1");
    try w.writeByte(':');
    try writeJsonString(w, gl.commit_sha);
    try w.writeAll("},");
    try writeJsonString(w, "entryPoint");
    try w.writeByte(':');
    try writeJsonString(w, gl.job_name);
    try w.writeAll("},");

    // "parameters" — all CI_*/GITLAB_*/RUNNER_* env vars
    try writeJsonString(w, "parameters");
    try w.writeAll(":{");
    {
        var first = true;
        const keys = gl.env_params.keys();
        const values = gl.env_params.values();
        for (keys, values) |key, value| {
            if (!first) try w.writeByte(',');
            first = false;
            try writeJsonString(w, key);
            try w.writeByte(':');
            try writeJsonString(w, value);
        }
    }
    try w.writeAll("},");

    // "environment"
    try writeJsonString(w, "environment");
    try w.writeAll(":{");
    try writeJsonString(w, "name");
    try w.writeByte(':');
    try writeJsonString(w, gl.runner_description);
    try w.writeByte(',');
    try writeJsonString(w, "architecture");
    try w.writeByte(':');
    try writeJsonString(w, gl.runner_arch);
    try w.writeByte(',');
    try writeJsonString(w, "server");
    try w.writeByte(':');
    try writeJsonString(w, gl.server_url);
    try w.writeByte(',');
    try writeJsonString(w, "project");
    try w.writeByte(':');
    try writeJsonString(w, gl.project_path);
    try w.writeByte(',');
    try writeJsonString(w, "job");
    try w.writeAll(":{");
    try writeJsonString(w, "id");
    try w.writeByte(':');
    try writeJsonString(w, gl.job_id);
    try w.writeAll("},");
    try writeJsonString(w, "pipeline");
    try w.writeAll(":{");
    try writeJsonString(w, "id");
    try w.writeByte(':');
    try writeJsonString(w, gl.pipeline_id);
    try w.writeByte(',');
    try writeJsonString(w, "ref");
    try w.writeByte(':');
    try writeJsonString(w, gl.config_path);
    try w.writeAll("}}},");

    // "metadata"
    try writeJsonString(w, "metadata");
    try w.writeAll(":{");
    try writeJsonString(w, "buildInvocationId");
    try w.writeByte(':');
    try writeJsonString(w, gl.job_url);
    try w.writeByte(',');
    try writeJsonString(w, "completeness");
    try w.writeAll(":{");
    try writeJsonString(w, "parameters");
    try w.writeAll(":true,");
    try writeJsonString(w, "environment");
    try w.writeAll(":true,");
    try writeJsonString(w, "materials");
    try w.writeAll(":false},");
    try writeJsonString(w, "reproducible");
    try w.writeAll(":false},");

    // "materials"
    try writeJsonString(w, "materials");
    try w.writeAll(":[{");
    try writeJsonString(w, "uri");
    try w.writeByte(':');
    try writeJsonString(w, try std.fmt.allocPrint(allocator, "git+{s}", .{gl.project_url}));
    try w.writeByte(',');
    try writeJsonString(w, "digest");
    try w.writeAll(":{");
    try writeJsonString(w, "sha1");
    try w.writeByte(':');
    try writeJsonString(w, gl.commit_sha);
    try w.writeAll("}}]}}");

    try w.writeByte('}');

    return buf.items;
}

/// Format a package name + version as a PURL.
/// Scoped: pkg:npm/%40scope/name@version
/// Unscoped: pkg:npm/name@version
fn fmtPurl(allocator: std.mem.Allocator, name: string, version: string) OOM!string {
    const version_without_build_tag = Dependency.withoutBuildTag(version);

    if (name.len > 0 and name[0] == '@') {
        // Scoped package: encode the @ as %40
        return std.fmt.allocPrint(allocator, "pkg:npm/%40{s}@{s}", .{
            name[1..],
            version_without_build_tag,
        });
    }

    return std.fmt.allocPrint(allocator, "pkg:npm/{s}@{s}", .{
        name,
        version_without_build_tag,
    });
}

/// Split GITHUB_WORKFLOW_REF on '@' into (path, ref).
/// e.g. "owner/repo/.github/workflows/publish.yml@refs/heads/main"
///   -> ("owner/repo/.github/workflows/publish.yml", "refs/heads/main")
fn splitWorkflowRef(workflow_ref: string) struct { string, string } {
    if (strings.indexOfChar(workflow_ref, '@')) |at_pos| {
        return .{ workflow_ref[0..at_pos], workflow_ref[at_pos + 1 ..] };
    }
    return .{ workflow_ref, "" };
}

/// Write the escaped content of a JSON string (without surrounding quotes).
fn writeJsonStringContent(w: anytype, s: string) @TypeOf(w).Error!void {
    for (s) |c| {
        switch (c) {
            '"' => try w.writeAll("\\\""),
            '\\' => try w.writeAll("\\\\"),
            '\n' => try w.writeAll("\\n"),
            '\r' => try w.writeAll("\\r"),
            '\t' => try w.writeAll("\\t"),
            0x08 => try w.writeAll("\\b"),
            0x0C => try w.writeAll("\\f"),
            else => {
                if (c < 0x20) {
                    try w.print("\\u{x:0>4}", .{@as(u16, c)});
                } else {
                    try w.writeByte(c);
                }
            },
        }
    }
}

/// Write a JSON-escaped string (with surrounding quotes).
/// Handles the standard JSON escape sequences.
pub fn writeJsonString(w: anytype, s: string) @TypeOf(w).Error!void {
    try w.writeByte('"');
    try writeJsonStringContent(w, s);
    try w.writeByte('"');
}

// ============================================================================
// Phase 3: Sigstore Signing
// ============================================================================

/// Result of the Sigstore signing process.
pub const SigningResult = struct {
    /// The DSSE envelope JSON (contains payload + signature)
    dsse_envelope: string,
    /// PEM-encoded certificate chain from Fulcio
    certificate_pem: string,
};

/// Sign the provenance statement via Sigstore (Fulcio + DSSE).
/// 1. Generate ephemeral ECDSA P-256 keypair
/// 2. Extract OIDC `sub` claim, sign it as proof-of-possession
/// 3. Request signing certificate from Fulcio
/// 4. Sign the DSSE envelope with ephemeral key
pub fn signProvenance(
    allocator: std.mem.Allocator,
    oidc_token: string,
    statement_json: string,
) SigningError!SigningResult {
    // Ensure BoringSSL is initialized
    bun.BoringSSL.load();

    // 3a: Generate ephemeral ECDSA P-256 keypair
    const key = try generateEphemeralKey();
    defer BoringSSL.EVP_PKEY_free(key);

    const public_key_pem = try exportPublicKeyPEM(allocator, key);

    // 3b: Get signing certificate from Fulcio
    const sub_claim = try extractJWTSubject(allocator, oidc_token);
    const proof_signature = try signData(allocator, key, sub_claim);
    const proof_b64 = try base64Encode(allocator, proof_signature);

    const certificate_pem = try requestFulcioCertificate(
        allocator,
        oidc_token,
        public_key_pem,
        proof_b64,
    );

    // 3c: Build and sign DSSE envelope
    const dsse_envelope = try buildDSSEEnvelope(allocator, key, statement_json);

    return .{
        .dsse_envelope = dsse_envelope,
        .certificate_pem = certificate_pem,
    };
}

// ── 3a: Ephemeral key generation ───────────────────────────────────────────

/// Generate an ephemeral ECDSA P-256 keypair using BoringSSL.
fn generateEphemeralKey() SigningError!*BoringSSL.EVP_PKEY {
    // Create parameter generation context for EC
    const param_ctx = BoringSSL.EVP_PKEY_CTX_new_id(BoringSSL.EVP_PKEY_EC, null) orelse
        return error.KeyGenFailed;
    defer BoringSSL.EVP_PKEY_CTX_free(param_ctx);

    if (BoringSSL.EVP_PKEY_paramgen_init(param_ctx) != 1)
        return error.KeyGenFailed;

    if (BoringSSL.EVP_PKEY_CTX_set_ec_paramgen_curve_nid(param_ctx, BoringSSL.NID_X9_62_prime256v1) != 1)
        return error.KeyGenFailed;

    // Generate parameters
    var params: ?*BoringSSL.EVP_PKEY = null;
    if (BoringSSL.EVP_PKEY_paramgen(param_ctx, @ptrCast(&params)) != 1)
        return error.KeyGenFailed;
    defer if (params) |p| BoringSSL.EVP_PKEY_free(p);

    const params_nonnull = params orelse return error.KeyGenFailed;

    // Create keygen context from parameters
    const key_ctx = BoringSSL.EVP_PKEY_CTX_new(params_nonnull, null) orelse
        return error.KeyGenFailed;
    defer BoringSSL.EVP_PKEY_CTX_free(key_ctx);

    if (BoringSSL.EVP_PKEY_keygen_init(key_ctx) != 1)
        return error.KeyGenFailed;

    // Generate the key
    var pkey: ?*BoringSSL.EVP_PKEY = null;
    if (BoringSSL.EVP_PKEY_keygen(key_ctx, @ptrCast(&pkey)) != 1)
        return error.KeyGenFailed;

    return pkey orelse error.KeyGenFailed;
}

/// Export EVP_PKEY public key as PEM string.
fn exportPublicKeyPEM(allocator: std.mem.Allocator, pkey: *BoringSSL.EVP_PKEY) SigningError!string {
    const bio = BoringSSL.BIO_new(BoringSSL.BIO_s_mem()) orelse
        return error.OutOfMemory;
    defer _ = BoringSSL.BIO_free(bio);

    if (BoringSSL.PEM_write_bio_PUBKEY(bio, pkey) != 1)
        return error.PEMEncodingFailed;

    const pending = BoringSSL.BIO_ctrl_pending(bio);
    if (pending == 0) return error.PEMEncodingFailed;

    const buf = try allocator.alloc(u8, pending);
    const read = BoringSSL.BIO_read(bio, buf.ptr, @intCast(pending));
    if (read <= 0) return error.PEMEncodingFailed;

    return buf[0..@intCast(read)];
}

// ── 3b: Fulcio certificate request ────────────────────────────────────────

/// Extract the `sub` claim from a JWT (without verifying the signature).
/// JWT format: base64url(header).base64url(payload).base64url(signature)
fn extractJWTSubject(allocator: std.mem.Allocator, jwt: string) SigningError!string {
    // Find the payload section (between first and second dots)
    const first_dot = strings.indexOfChar(jwt, '.') orelse return error.JWTDecodeFailed;
    const rest = jwt[first_dot + 1 ..];
    const second_dot = strings.indexOfChar(rest, '.') orelse return error.JWTDecodeFailed;
    const payload_b64 = rest[0..second_dot];

    // Base64url decode the payload
    const decoded = try base64UrlDecode(allocator, payload_b64);

    // Parse JSON and extract "sub"
    const source = logger.Source.initPathString("jwt-payload", decoded);
    var log = logger.Log.init(allocator);
    defer log.deinit();

    const json = JSON.parseUTF8(&source, &log, allocator) catch
        return error.JWTDecodeFailed;

    return json.getStringCloned(allocator, "sub") catch {
        return error.OutOfMemory;
    } orelse {
        return error.JWTDecodeFailed;
    };
}

/// Sign data with an EVP_PKEY using SHA-256 + ECDSA.
fn signData(allocator: std.mem.Allocator, pkey: *BoringSSL.EVP_PKEY, data: string) SigningError!string {
    const md_ctx = BoringSSL.EVP_MD_CTX_new();
    if (md_ctx == null) return error.SigningFailed;
    defer BoringSSL.EVP_MD_CTX_free(md_ctx);

    if (BoringSSL.EVP_DigestSignInit(md_ctx, null, BoringSSL.EVP_sha256(), null, pkey) != 1)
        return error.SigningFailed;

    // First call to get signature length
    var sig_len: usize = 0;
    if (BoringSSL.EVP_DigestSign(md_ctx, null, &sig_len, data.ptr, data.len) != 1)
        return error.SigningFailed;

    const sig_buf = try allocator.alloc(u8, sig_len);

    // Second call to actually sign
    if (BoringSSL.EVP_DigestSign(md_ctx, sig_buf.ptr, &sig_len, data.ptr, data.len) != 1)
        return error.SigningFailed;

    return sig_buf[0..sig_len];
}

/// Request a signing certificate from Fulcio.
/// POST https://fulcio.sigstore.dev/api/v2/signingCert
fn requestFulcioCertificate(
    allocator: std.mem.Allocator,
    oidc_token: string,
    public_key_pem: string,
    proof_b64: string,
) SigningError!string {
    // Build request body JSON
    var body_buf = std.ArrayListUnmanaged(u8){};
    defer body_buf.deinit(allocator);
    const bw = body_buf.writer(allocator);

    try bw.writeAll("{\"credentials\":{\"oidcIdentityToken\":");
    try writeJsonString(bw, oidc_token);
    try bw.writeAll("},\"publicKeyRequest\":{\"publicKey\":{\"algorithm\":\"ECDSA\",\"content\":");
    try writeJsonString(bw, public_key_pem);
    try bw.writeAll("},\"proofOfPossession\":");
    try writeJsonString(bw, proof_b64);
    try bw.writeAll("}}");

    const fulcio_url = URL.parse(bun.getenvZ("SIGSTORE_FULCIO_URL") orelse "https://fulcio.sigstore.dev/api/v2/signingCert");

    var headers: http.HeaderBuilder = .{};

    {
        headers.count("content-type", "application/json");
        headers.count("accept", "application/pem-certificate-chain");
    }

    try headers.allocate(allocator);

    {
        headers.append("content-type", "application/json");
        headers.append("accept", "application/pem-certificate-chain");
    }

    var response_buf = MutableString.init(allocator, 4096) catch return error.OutOfMemory;
    defer response_buf.deinit();

    var req = http.AsyncHTTP.initSync(
        allocator,
        .POST,
        fulcio_url,
        headers.entries,
        headers.content.ptr.?[0..headers.content.len],
        &response_buf,
        body_buf.items,
        null,
        null,
        .follow,
    );

    const res = req.sendSync() catch |err| {
        switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.FulcioRequestFailed,
        }
    };

    if (res.status_code != 200 and res.status_code != 201) {
        return error.FulcioRequestFailed;
    }

    // The response body is the PEM certificate chain
    if (response_buf.list.items.len == 0) return error.FulcioResponseInvalid;

    return try allocator.dupe(u8, response_buf.list.items);
}

// ── 3c: DSSE envelope ─────────────────────────────────────────────────────

/// Build a DSSE (Dead Simple Signing Envelope) for the in-toto statement.
/// PAE = "DSSEv1" SP len(type) SP type SP len(body) SP body
fn buildDSSEEnvelope(allocator: std.mem.Allocator, pkey: *BoringSSL.EVP_PKEY, payload: string) SigningError!string {
    const payload_type = "application/vnd.in-toto+json";

    // Build PAE (Pre-Authentication Encoding)
    var pae_buf = std.ArrayListUnmanaged(u8){};
    defer pae_buf.deinit(allocator);
    const pae_w = pae_buf.writer(allocator);

    try pae_w.print("DSSEv1 {d} {s} {d} {s}", .{
        payload_type.len,
        payload_type,
        payload.len,
        payload,
    });

    // Sign the PAE
    const signature = try signData(allocator, pkey, pae_buf.items);
    const sig_b64 = try base64Encode(allocator, signature);
    const payload_b64 = try base64Encode(allocator, payload);

    // Build envelope JSON
    var env_buf = std.ArrayListUnmanaged(u8){};
    const env_w = env_buf.writer(allocator);

    try env_w.writeAll("{\"payloadType\":");
    try writeJsonString(env_w, payload_type);
    try env_w.writeAll(",\"payload\":");
    try writeJsonString(env_w, payload_b64);
    try env_w.writeAll(",\"signatures\":[{\"sig\":");
    try writeJsonString(env_w, sig_b64);
    try env_w.writeAll("}]}");

    return env_buf.items;
}

// ── Encoding helpers ──────────────────────────────────────────────────────

/// Base64 standard encode (with padding).
fn base64Encode(allocator: std.mem.Allocator, data: string) OOM!string {
    const encoded_len = std.base64.standard.Encoder.calcSize(data.len);
    const buf = try allocator.alloc(u8, encoded_len);
    _ = std.base64.standard.Encoder.encode(buf, data);
    return buf;
}

/// Base64url decode (handles missing padding).
fn base64UrlDecode(allocator: std.mem.Allocator, input: string) SigningError!string {
    // Add padding if needed (url_safe decoder requires it)
    const padding_needed = (4 - (input.len % 4)) % 4;
    const padded = if (padding_needed > 0) blk: {
        const buf = try allocator.alloc(u8, input.len + padding_needed);
        @memcpy(buf[0..input.len], input);
        @memset(buf[input.len..], '=');
        break :blk buf;
    } else input;
    defer if (padding_needed > 0) allocator.free(padded);

    const decoded_size = std.base64.url_safe.Decoder.calcSizeForSlice(padded) catch
        return error.JWTDecodeFailed;
    const buf = try allocator.alloc(u8, decoded_size);

    std.base64.url_safe.Decoder.decode(buf, padded) catch
        return error.JWTDecodeFailed;

    return buf[0..decoded_size];
}

// ============================================================================
// Phase 4: Rekor Transparency Log
// ============================================================================

pub const RekorError = error{
    RekorRequestFailed,
    RekorResponseInvalid,
} || OOM;

/// A transparency log entry returned by Rekor.
/// Contains all fields needed to assemble the Sigstore bundle in Phase 5.
pub const RekorEntry = struct {
    /// UUID of the transparency log entry (the key in the response object)
    uuid: string,
    /// base64-encoded body of the entry
    body: string,
    /// Unix timestamp when the entry was integrated into the log
    integrated_time: i64,
    /// Hex-encoded log ID
    log_id: string,
    /// Numeric log index
    log_index: i64,
    /// base64-encoded signed entry timestamp (inclusion promise)
    signed_entry_timestamp: string,
    /// Inclusion proof (may be absent for pending entries)
    inclusion_proof: ?InclusionProof,

    pub const InclusionProof = struct {
        log_index: i64,
        root_hash: string,
        tree_size: i64,
        hashes: []const string,
        checkpoint: string,
    };
};

/// Submit a signed DSSE envelope to the Rekor transparency log.
/// POST https://rekor.sigstore.dev/api/v1/log/entries
///
/// Uses the `dsse` entry kind (apiVersion 0.0.2) which accepts the
/// DSSE envelope directly along with the Fulcio certificate as verifier.
pub fn submitToRekor(
    allocator: std.mem.Allocator,
    signing_result: SigningResult,
) RekorError!RekorEntry {
    // Build request body:
    // {
    //   "apiVersion": "0.0.2",
    //   "kind": "dsse",
    //   "spec": {
    //     "proposedContent": {
    //       "envelope": "<DSSE envelope JSON>",
    //       "verifiers": ["<PEM certificate>"]
    //     }
    //   }
    // }
    var body_buf = std.ArrayListUnmanaged(u8){};
    defer body_buf.deinit(allocator);
    const bw = body_buf.writer(allocator);

    try bw.writeAll("{\"apiVersion\":\"0.0.2\",\"kind\":\"dsse\",\"spec\":{\"proposedContent\":{\"envelope\":");
    try writeJsonString(bw, signing_result.dsse_envelope);
    try bw.writeAll(",\"verifiers\":[");
    try writeJsonString(bw, signing_result.certificate_pem);
    try bw.writeAll("]}}}");

    const rekor_url = URL.parse(bun.getenvZ("SIGSTORE_REKOR_URL") orelse "https://rekor.sigstore.dev/api/v1/log/entries");

    // Build headers (count → allocate → append pattern)
    var headers: http.HeaderBuilder = .{};

    {
        headers.count("content-type", "application/json");
        headers.count("accept", "application/json");
    }

    try headers.allocate(allocator);

    {
        headers.append("content-type", "application/json");
        headers.append("accept", "application/json");
    }

    var response_buf = MutableString.init(allocator, 8192) catch return error.OutOfMemory;
    defer response_buf.deinit();

    var req = http.AsyncHTTP.initSync(
        allocator,
        .POST,
        rekor_url,
        headers.entries,
        headers.content.ptr.?[0..headers.content.len],
        &response_buf,
        body_buf.items,
        null,
        null,
        .follow,
    );

    const res = req.sendSync() catch |err| {
        switch (err) {
            error.OutOfMemory => return error.OutOfMemory,
            else => return error.RekorRequestFailed,
        }
    };

    if (res.status_code != 200 and res.status_code != 201) {
        return error.RekorRequestFailed;
    }

    if (response_buf.list.items.len == 0) return error.RekorResponseInvalid;

    return parseRekorResponse(allocator, response_buf.list.items);
}

/// Parse the Rekor response JSON.
/// The response is an object with a single key (the entry UUID) whose value
/// contains the log entry fields:
/// { "<uuid>": { "body": "...", "integratedTime": N, "logID": "...", "logIndex": N, "verification": { ... } } }
fn parseRekorResponse(allocator: std.mem.Allocator, response: string) RekorError!RekorEntry {
    const source = logger.Source.initPathString("rekor-response", response);
    var log = logger.Log.init(allocator);
    defer log.deinit();

    const json = JSON.parseUTF8(&source, &log, allocator) catch {
        return error.RekorResponseInvalid;
    };

    // Response is { "<uuid>": { ... } } — get the first property
    if (json.data != .e_object) return error.RekorResponseInvalid;
    const root_props = json.data.e_object.properties.slice();
    if (root_props.len == 0) return error.RekorResponseInvalid;

    const first_prop = root_props[0];
    const uuid_key = first_prop.key orelse return error.RekorResponseInvalid;
    const uuid = (uuid_key.asStringCloned(allocator) catch return error.OutOfMemory) orelse return error.RekorResponseInvalid;

    const entry = first_prop.value orelse return error.RekorResponseInvalid;
    if (entry.data != .e_object) return error.RekorResponseInvalid;

    // Extract required fields
    const body_str = entry.getStringCloned(allocator, "body") catch {
        return error.OutOfMemory;
    } orelse return error.RekorResponseInvalid;

    const log_id = entry.getStringCloned(allocator, "logID") catch {
        return error.OutOfMemory;
    } orelse return error.RekorResponseInvalid;

    const integrated_time: i64 = if (entry.getNumber("integratedTime")) |n|
        @intFromFloat(n[0])
    else
        return error.RekorResponseInvalid;

    const log_index: i64 = if (entry.getNumber("logIndex")) |n|
        @intFromFloat(n[0])
    else
        return error.RekorResponseInvalid;

    // Extract verification object
    var signed_entry_timestamp: string = "";
    var inclusion_proof: ?RekorEntry.InclusionProof = null;

    if (entry.get("verification")) |verification| {
        // signedEntryTimestamp (inclusion promise)
        signed_entry_timestamp = verification.getStringCloned(allocator, "signedEntryTimestamp") catch {
            return error.OutOfMemory;
        } orelse "";

        // inclusionProof (may be absent)
        if (verification.get("inclusionProof")) |proof| {
            const proof_log_index: i64 = if (proof.getNumber("logIndex")) |n|
                @intFromFloat(n[0])
            else
                0;

            const root_hash = proof.getStringCloned(allocator, "rootHash") catch {
                return error.OutOfMemory;
            } orelse "";

            const tree_size: i64 = if (proof.getNumber("treeSize")) |n|
                @intFromFloat(n[0])
            else
                0;

            const checkpoint = proof.getStringCloned(allocator, "checkpoint") catch {
                return error.OutOfMemory;
            } orelse "";

            // Parse hashes array
            var hashes_list = std.ArrayListUnmanaged(string){};
            if (proof.getArray("hashes")) |hashes_val| {
                var iter = hashes_val;
                while (iter.next()) |hash_expr| {
                    const hash_str = (hash_expr.asStringCloned(allocator) catch return error.OutOfMemory) orelse continue;
                    try hashes_list.append(allocator, hash_str);
                }
            }

            inclusion_proof = .{
                .log_index = proof_log_index,
                .root_hash = root_hash,
                .tree_size = tree_size,
                .hashes = hashes_list.items,
                .checkpoint = checkpoint,
            };
        }
    }

    return .{
        .uuid = uuid,
        .body = body_str,
        .integrated_time = integrated_time,
        .log_id = log_id,
        .log_index = log_index,
        .signed_entry_timestamp = signed_entry_timestamp,
        .inclusion_proof = inclusion_proof,
    };
}

// ============================================================================
// Phase 5: Sigstore Bundle Assembly
// ============================================================================

/// Build a Sigstore bundle v0.3 JSON from the signing result and Rekor entry.
///
/// The bundle follows the protobuf-specs format:
/// - mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json"
/// - dsseEnvelope: the DSSE envelope as a JSON object (not string)
/// - verificationMaterial.certificate: leaf cert as base64 DER (v0.3 uses singular)
/// - verificationMaterial.tlogEntries: transparency log entry from Rekor
pub fn buildSigstoreBundle(
    allocator: std.mem.Allocator,
    signing_result: SigningResult,
    rekor_entry: RekorEntry,
) OOM!string {
    var buf = std.ArrayListUnmanaged(u8){};
    const w = buf.writer(allocator);

    try w.writeAll(
        \\{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json","dsseEnvelope":
    );
    try w.writeAll(signing_result.dsse_envelope);

    // certificate rawBytes: base64-encoded DER of the leaf certificate
    try w.writeAll(
        \\,"verificationMaterial":{"certificate":{"rawBytes":
    );
    const der_b64 = try pemToDerBase64(allocator, signing_result.certificate_pem);
    try writeJsonString(w, der_b64);

    // logIndex: write int directly as quoted string — no allocPrint needed
    try w.writeAll(
        \\},"tlogEntries":[{"logIndex":"
    );
    try w.print("{d}", .{rekor_entry.log_index});

    // logId.keyId: hex → base64
    try w.writeAll(
        \\","logId":{"keyId":
    );
    const log_id_b64 = try hexToBase64(allocator, rekor_entry.log_id);
    try writeJsonString(w, log_id_b64);

    // kindVersion + integratedTime (int directly as quoted string)
    try w.writeAll(
        \\},"kindVersion":{"kind":"dsse","version":"0.0.2"},"integratedTime":"
    );
    try w.print("{d}", .{rekor_entry.integrated_time});
    try w.writeByte('"');

    // inclusionPromise (optional for v0.3)
    if (rekor_entry.signed_entry_timestamp.len > 0) {
        try w.writeAll(
            \\,"inclusionPromise":{"signedEntryTimestamp":
        );
        try writeJsonString(w, rekor_entry.signed_entry_timestamp);
        try w.writeByte('}');
    }

    // inclusionProof (required for v0.3)
    if (rekor_entry.inclusion_proof) |proof| {
        try w.writeAll(
            \\,"inclusionProof":{"logIndex":"
        );
        try w.print("{d}", .{proof.log_index});

        // rootHash: hex → base64
        try w.writeAll(
            \\","rootHash":
        );
        const root_hash_b64 = try hexToBase64(allocator, proof.root_hash);
        try writeJsonString(w, root_hash_b64);

        try w.writeAll(
            \\,"treeSize":"
        );
        try w.print("{d}", .{proof.tree_size});
        try w.writeAll(
            \\","hashes":[
        );

        for (proof.hashes, 0..) |hash_hex, i| {
            if (i > 0) try w.writeByte(',');
            const hash_b64 = try hexToBase64(allocator, hash_hex);
            try writeJsonString(w, hash_b64);
        }

        try w.writeAll(
            \\],"checkpoint":{"envelope":
        );
        try writeJsonString(w, proof.checkpoint);
        try w.writeAll("}}");
    }

    // canonicalizedBody (already base64 from Rekor)
    try w.writeAll(
        \\,"canonicalizedBody":
    );
    try writeJsonString(w, rekor_entry.body);
    try w.writeAll("}]}}"); // close tlogEntry, tlogEntries, verificationMaterial, root

    return buf.items;
}

/// Extract the first certificate from a PEM chain and return as base64-encoded DER.
///
/// PEM format wraps DER bytes in base64 with header/footer lines:
///   -----BEGIN CERTIFICATE-----
///   MIIBxTCCAWug...
///   -----END CERTIFICATE-----
///
/// Stripping the markers and whitespace yields the base64 DER directly.
fn pemToDerBase64(allocator: std.mem.Allocator, pem: string) OOM!string {
    const begin_marker = "-----BEGIN CERTIFICATE-----";
    const end_marker = "-----END CERTIFICATE-----";

    const begin_pos = strings.indexOf(pem, begin_marker) orelse return "";
    const content_start = begin_pos + begin_marker.len;

    const rest = pem[content_start..];
    const end_pos = strings.indexOf(rest, end_marker) orelse return "";
    const pem_content = rest[0..end_pos];

    // Strip all whitespace to get clean base64 — preallocate max size to avoid per-byte appends
    const buf = try allocator.alloc(u8, pem_content.len);
    var len: usize = 0;
    for (pem_content) |c| {
        if (c != '\n' and c != '\r' and c != ' ' and c != '\t') {
            buf[len] = c;
            len += 1;
        }
    }

    return buf[0..len];
}

/// Convert a hex-encoded string to base64-encoded bytes.
/// Used for Rekor fields (logID, rootHash, hashes) which come as hex
/// but must be base64 in the Sigstore bundle protobuf JSON format.
fn hexToBase64(allocator: std.mem.Allocator, hex_str: string) OOM!string {
    if (hex_str.len == 0 or hex_str.len % 2 != 0) return "";

    const byte_len = hex_str.len / 2;
    const bytes = try allocator.alloc(u8, byte_len);
    defer allocator.free(bytes);

    for (bytes, 0..) |*byte, i| {
        byte.* = (hexNibble(hex_str[i * 2]) << 4) | hexNibble(hex_str[i * 2 + 1]);
    }

    return base64Encode(allocator, bytes);
}

fn hexNibble(c: u8) u8 {
    return switch (c) {
        '0'...'9' => c - '0',
        'a'...'f' => c - 'a' + 10,
        'A'...'F' => c - 'A' + 10,
        else => 0,
    };
}

/// Print a user-friendly error message for Rekor errors.
pub fn printRekorError(err: RekorError) void {
    switch (err) {
        error.RekorRequestFailed => {
            Output.errGeneric("failed to submit to Rekor transparency log (https://rekor.sigstore.dev)", .{});
        },
        error.RekorResponseInvalid => {
            Output.errGeneric("invalid response from Rekor transparency log", .{});
        },
        error.OutOfMemory => {
            bun.outOfMemory();
        },
    }
}

/// Print a user-friendly error message for provenance errors.
pub fn printError(err: ProvenanceError) void {
    switch (err) {
        error.NotInCI => {
            Output.errGeneric(
                "provenance generation requires a supported CI environment (GitHub Actions or GitLab CI)",
                .{},
            );
        },
        error.UnsupportedCI => {
            Output.errGeneric(
                "provenance generation is only supported in GitHub Actions and GitLab CI",
                .{},
            );
        },
        error.MissingOIDCEndpoint => {
            Output.errGeneric(
                "missing OIDC endpoint. Ensure your GitHub Actions workflow has " ++
                    "`permissions: id-token: write`",
                .{},
            );
        },
        error.MissingOIDCToken => {
            Output.errGeneric(
                "missing OIDC identity token. For GitHub Actions, ensure " ++
                    "`permissions: id-token: write` is set. " ++
                    "For GitLab CI, ensure `SIGSTORE_ID_TOKEN` is available.",
                .{},
            );
        },
        error.OIDCRequestFailed => {
            Output.errGeneric("failed to fetch OIDC identity token from CI provider", .{});
        },
        error.OIDCResponseInvalid => {
            Output.errGeneric("invalid OIDC token response from CI provider", .{});
        },
        error.MissingGitHubEnvVars => {
            Output.errGeneric(
                "missing required GitHub Actions environment variables for provenance generation",
                .{},
            );
        },
        error.OutOfMemory => {
            bun.outOfMemory();
        },
    }
}

/// Print a user-friendly error message for signing errors.
pub fn printSigningError(err: SigningError) void {
    switch (err) {
        error.KeyGenFailed => {
            Output.errGeneric("failed to generate ephemeral signing key", .{});
        },
        error.PEMEncodingFailed => {
            Output.errGeneric("failed to encode public key as PEM", .{});
        },
        error.SigningFailed => {
            Output.errGeneric("failed to sign provenance data", .{});
        },
        error.FulcioRequestFailed => {
            Output.errGeneric("failed to obtain signing certificate from Fulcio (https://fulcio.sigstore.dev)", .{});
        },
        error.FulcioResponseInvalid => {
            Output.errGeneric("invalid response from Fulcio certificate authority", .{});
        },
        error.JWTDecodeFailed => {
            Output.errGeneric("failed to decode OIDC identity token", .{});
        },
        error.OutOfMemory => {
            bun.outOfMemory();
        },
    }
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const JSON = bun.json;
const MutableString = bun.MutableString;
const OOM = bun.OOM;
const Output = bun.Output;
const URL = bun.URL;
const logger = bun.logger;
const strings = bun.strings;

const http = bun.http;

const BoringSSL = bun.BoringSSL.c;

const install = bun.install;
const Dependency = install.Dependency;
