/// OIDC (OpenID Connect) trusted publishing for npm registries.
///
/// Enables tokenless authentication in CI by exchanging an OIDC identity token
/// with the npm registry for a short-lived publish token. This eliminates the
/// need for long-lived NPM_TOKEN secrets.
///
/// Supported token sources:
///   - NPM_ID_TOKEN env var (any CI provider — GitLab CI, CircleCI, etc.)
///   - GitHub Actions OIDC auto-fetch (via ACTIONS_ID_TOKEN_REQUEST_URL)
///
/// The flow:
///   1. Read NPM_ID_TOKEN, or fetch an OIDC token from GitHub Actions
///   2. Exchange it with the registry at /-/npm/v1/oidc/token/exchange/package/{name}
///   3. Registry returns a short-lived npm auth token
///
/// References:
///   - npm CLI: lib/utils/oidc.js
///   - GitHub Actions OIDC: https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect

/// Attempts OIDC authentication for npm publishing.
/// Returns a short-lived npm auth token, or null if OIDC is not available or fails.
/// This function never returns an error — OIDC is always optional and best-effort.
pub fn attemptOidcAuth(
    allocator: std.mem.Allocator,
    registry: *const Npm.Registry.Scope,
    package_name: string,
) ?string {
    const identity_token = fetchIdentityToken(allocator, registry) orelse return null;
    return exchangeToken(allocator, registry, package_name, identity_token);
}

/// Fetches an OIDC identity token from the CI environment.
///
/// Checks (in order):
///   1. NPM_ID_TOKEN env var (works for all CI providers)
///   2. GitHub Actions OIDC token request (requires id-token: write permission)
fn fetchIdentityToken(allocator: std.mem.Allocator, registry: *const Npm.Registry.Scope) ?string {
    // Path 1: NPM_ID_TOKEN environment variable (all CI providers)
    if (bun.env_var.NPM_ID_TOKEN.get()) |token| {
        if (token.len > 0) return token;
    }

    // Path 2: GitHub Actions OIDC token request
    if (bun.env_var.GITHUB_ACTIONS.get()) {
        return fetchGitHubActionsToken(allocator, registry);
    }

    return null;
}

/// Fetches an OIDC token from the GitHub Actions runtime.
///
/// GET ${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=npm:${registry_hostname}
/// Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}
fn fetchGitHubActionsToken(allocator: std.mem.Allocator, registry: *const Npm.Registry.Scope) ?string {
    const base_url = bun.env_var.ACTIONS_ID_TOKEN_REQUEST_URL.get() orelse return null;
    const request_token = bun.env_var.ACTIONS_ID_TOKEN_REQUEST_TOKEN.get() orelse return null;

    if (base_url.len == 0 or request_token.len == 0) return null;

    // Build URL with audience parameter: npm:{registry_hostname}
    // The registry URL's hostname (without port) identifies which registry we're authenticating to
    const registry_hostname = registry.url.hostname;
    if (registry_hostname.len == 0) return null;

    // ACTIONS_ID_TOKEN_REQUEST_URL always includes a trailing '?' with query params
    // (e.g. "https://vstoken.actions.githubusercontent.com/.identity?api-version=...&").
    // Appending "&audience=" matches the npm CLI behavior (lib/utils/oidc.js).
    var url_buf = std.array_list.Managed(u8).init(allocator);
    defer url_buf.deinit();
    url_buf.writer().print("{s}&audience=npm:{s}", .{ base_url, registry_hostname }) catch return null;

    const token_url = URL.parse(url_buf.items);

    // Build request headers
    var auth_buf = std.array_list.Managed(u8).init(allocator);
    defer auth_buf.deinit();
    auth_buf.writer().print("Bearer {s}", .{request_token}) catch return null;

    var headers: http.HeaderBuilder = .{};
    headers.count("authorization", auth_buf.items);
    headers.count("accept", "application/json");
    headers.allocate(allocator) catch return null;
    headers.append("authorization", auth_buf.items);
    headers.append("accept", "application/json");

    var response_buf = MutableString.init(allocator, 1024) catch return null;
    defer response_buf.deinit();

    // AsyncHTTP.initSync has no connection-phase timeout parameter. Once the socket
    // is open the HTTP client sets a 5-minute post-connection timeout (see
    // onWritable in src/http.zig), but the initial TCP handshake falls through to
    // the kernel default (~2 min on Linux). For a best-effort OIDC lookup that's
    // acceptable — an unreachable endpoint will eventually time out and we return
    // null, letting publish fall through to the existing NeedAuth error path.
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

    const res = req.sendSync() catch return null;
    if (res.status_code != 200) return null;

    // Parse response: { "value": "<JWT>" }
    const source = logger.Source.initPathString("oidc-token", response_buf.list.items);
    // Log is not deinitialized — matches the pattern in checkPackageVersionExists.
    var log = logger.Log.init(allocator);
    const json = JSON.parseUTF8(&source, &log, allocator) catch return null;

    const maybe_token = json.getStringCloned(allocator, "value") catch return null;
    const token = maybe_token orelse return null;
    if (token.len == 0) return null;

    return token;
}

/// Exchanges an OIDC identity token with the npm registry for a short-lived publish token.
///
/// POST ${registry}/-/npm/v1/oidc/token/exchange/package/${escapedPackageName}
/// Authorization: Bearer ${identity_token}
fn exchangeToken(
    allocator: std.mem.Allocator,
    registry: *const Npm.Registry.Scope,
    package_name: string,
    identity_token: string,
) ?string {
    const registry_url = strings.withoutTrailingSlash(registry.url.href);
    const encoded_name = bun.fmt.dependencyUrl(package_name);

    var url_buf = std.array_list.Managed(u8).init(allocator);
    defer url_buf.deinit();
    url_buf.writer().print("{s}/-/npm/v1/oidc/token/exchange/package/{f}", .{
        registry_url,
        encoded_name,
    }) catch return null;

    const exchange_url = URL.parse(url_buf.items);

    // Build request headers with OIDC token as Bearer auth
    var auth_buf = std.array_list.Managed(u8).init(allocator);
    defer auth_buf.deinit();
    auth_buf.writer().print("Bearer {s}", .{identity_token}) catch return null;

    var headers: http.HeaderBuilder = .{};
    headers.count("authorization", auth_buf.items);
    headers.count("accept", "application/json");
    headers.count("content-length", "0");
    headers.allocate(allocator) catch return null;
    headers.append("authorization", auth_buf.items);
    headers.append("accept", "application/json");
    headers.append("content-length", "0");

    var response_buf = MutableString.init(allocator, 1024) catch return null;
    defer response_buf.deinit();

    // Same timeout caveat as fetchGitHubActionsToken — no connect-phase timeout,
    // 5-minute post-connection timeout applies. Best-effort: a hung exchange falls
    // through to NeedAuth.
    var req = http.AsyncHTTP.initSync(
        allocator,
        .POST,
        exchange_url,
        headers.entries,
        headers.content.ptr.?[0..headers.content.len],
        &response_buf,
        "",
        null,
        null,
        .follow,
    );

    const res = req.sendSync() catch return null;
    if (res.status_code != 200) return null;

    // Parse response: { "token": "<short-lived-npm-token>" }
    const source = logger.Source.initPathString("oidc-exchange", response_buf.list.items);
    // Log is not deinitialized — matches the pattern in checkPackageVersionExists.
    var log = logger.Log.init(allocator);
    const json = JSON.parseUTF8(&source, &log, allocator) catch return null;

    const maybe_token = json.getStringCloned(allocator, "token") catch return null;
    const token = maybe_token orelse return null;
    if (token.len == 0) return null;

    return token;
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const JSON = bun.json;
const MutableString = bun.MutableString;
const URL = bun.URL;
const logger = bun.logger;
const strings = bun.strings;

const http = bun.http;

const install = bun.install;
const Npm = install.Npm;
