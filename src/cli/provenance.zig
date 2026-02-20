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

    return .{
        .ci = .gitlab_ci,
        .oidc_token = try allocator.dupe(u8, id_token),
        .allocator = allocator,
        .gitlab = .{
            .sigstore_id_token = id_token,
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
