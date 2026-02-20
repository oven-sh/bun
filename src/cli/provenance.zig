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
    env_params: std.StringArrayHashMapUnmanaged(string),
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
    var env_params: std.StringArrayHashMapUnmanaged(string) = .{};
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

    try w.writeAll("{");

    // "_type"
    try writeJsonString(w, "_type");
    try w.writeByte(':');
    try writeJsonString(w, "https://in-toto.io/Statement/v1");
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
    try writeJsonString(w, "https://slsa.dev/provenance/v1");
    try w.writeByte(',');

    // "predicate"
    try writeJsonString(w, "predicate");
    try w.writeAll(":{");

    // "buildDefinition"
    try writeJsonString(w, "buildDefinition");
    try w.writeAll(":{");

    try writeJsonString(w, "buildType");
    try w.writeByte(':');
    try writeJsonString(w, "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1");
    try w.writeByte(',');

    // "externalParameters"
    try writeJsonString(w, "externalParameters");
    try w.writeAll(":{");
    try writeJsonString(w, "workflow");
    try w.writeAll(":{");
    try writeJsonString(w, "ref");
    try w.writeByte(':');
    try writeJsonString(w, workflow_ref);
    try w.writeByte(',');
    try writeJsonString(w, "repository");
    try w.writeByte(':');
    try writeJsonString(w, try std.fmt.allocPrint(allocator, "{s}/{s}", .{ gh.server_url, gh.repository }));
    try w.writeByte(',');
    try writeJsonString(w, "path");
    try w.writeByte(':');
    try writeJsonString(w, workflow_path);
    try w.writeAll("}},");

    // "internalParameters"
    try writeJsonString(w, "internalParameters");
    try w.writeAll(":{");
    try writeJsonString(w, "github");
    try w.writeAll(":{");
    try writeJsonString(w, "event_name");
    try w.writeByte(':');
    try writeJsonString(w, gh.event_name);
    try w.writeByte(',');
    try writeJsonString(w, "repository_id");
    try w.writeByte(':');
    try writeJsonString(w, gh.repository_id);
    try w.writeByte(',');
    try writeJsonString(w, "repository_owner_id");
    try w.writeByte(':');
    try writeJsonString(w, gh.repository_owner_id);
    try w.writeAll("}},");

    // "resolvedDependencies"
    try writeJsonString(w, "resolvedDependencies");
    try w.writeAll(":[{");
    try writeJsonString(w, "uri");
    try w.writeByte(':');
    try writeJsonString(w, try std.fmt.allocPrint(allocator, "git+{s}/{s}@{s}", .{ gh.server_url, gh.repository, gh.ref }));
    try w.writeByte(',');
    try writeJsonString(w, "digest");
    try w.writeAll(":{");
    try writeJsonString(w, "gitCommit");
    try w.writeByte(':');
    try writeJsonString(w, gh.sha);
    try w.writeAll("}}]},");

    // "runDetails"
    try writeJsonString(w, "runDetails");
    try w.writeAll(":{");
    try writeJsonString(w, "builder");
    try w.writeAll(":{");
    try writeJsonString(w, "id");
    try w.writeByte(':');
    try writeJsonString(w, try std.fmt.allocPrint(allocator, "https://github.com/actions/runner/{s}", .{gh.runner_environment}));
    try w.writeAll("},");
    try writeJsonString(w, "metadata");
    try w.writeAll(":{");
    try writeJsonString(w, "invocationId");
    try w.writeByte(':');
    try writeJsonString(w, try std.fmt.allocPrint(allocator, "{s}/{s}/actions/runs/{s}/attempts/{s}", .{ gh.server_url, gh.repository, gh.run_id, gh.run_attempt }));
    try w.writeAll("}}}}");

    try w.writeByte('}');

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

/// Write a JSON-escaped string (with surrounding quotes).
/// Handles the standard JSON escape sequences.
fn writeJsonString(w: anytype, s: string) @TypeOf(w).Error!void {
    try w.writeByte('"');
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
    try w.writeByte('"');
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Global = bun.Global;
const JSON = bun.json;
const MutableString = bun.MutableString;
const OOM = bun.OOM;
const Output = bun.Output;
const URL = bun.URL;
const logger = bun.logger;
const strings = bun.strings;

const http = bun.http;

const install = bun.install;
const Dependency = install.Dependency;
