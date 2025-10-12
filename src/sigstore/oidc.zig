const std = @import("std");
const bun = @import("bun");
const http = bun.http;
const MutableString = bun.MutableString;
const URL = bun.URL;

pub const OIDCError = error{
    TokenAcquisitionFailed,
    InvalidToken,
    UnsupportedProvider,
    MissingEnvironment,
    NetworkError,
    InvalidResponse,
    OutOfMemory,
};

/// OIDC token with metadata
pub const OIDCToken = struct {
    token: []const u8,
    expires_at: ?i64, // Unix timestamp
    audience: ?[]const u8,
    issuer: ?[]const u8,
    allocator: std.mem.Allocator,

    pub fn deinit(self: *OIDCToken) void {
        self.allocator.free(self.token);
        if (self.audience) |audience| self.allocator.free(audience);
        if (self.issuer) |issuer| self.allocator.free(issuer);
    }

    pub fn isExpired(self: *const OIDCToken) bool {
        if (self.expires_at) |expires| {
            const now = std.time.timestamp();
            return now >= expires;
        }
        return false; // No expiry info, assume valid
    }
};

/// Interface for OIDC token providers
pub const OIDCProvider = struct {
    const Self = @This();

    ptr: *anyopaque,
    vtable: *const VTable,

    pub const VTable = struct {
        getToken: *const fn (ptr: *anyopaque, allocator: std.mem.Allocator) OIDCError!OIDCToken,
        isSupported: *const fn (ptr: *anyopaque) bool,
        getName: *const fn (ptr: *anyopaque) []const u8,
    };

    pub fn getToken(self: Self, allocator: std.mem.Allocator) OIDCError!OIDCToken {
        return self.vtable.getToken(self.ptr, allocator);
    }

    pub fn isSupported(self: Self) bool {
        return self.vtable.isSupported(self.ptr);
    }

    pub fn getName(self: Self) []const u8 {
        return self.vtable.getName(self.ptr);
    }
};

/// GitHub Actions OIDC provider
pub const GitHubActionsProvider = struct {
    const Self = @This();

    pub fn init() Self {
        return Self{};
    }

    pub fn provider(self: *Self) OIDCProvider {
        return OIDCProvider{
            .ptr = self,
            .vtable = &.{
                .getToken = getToken,
                .isSupported = isSupported,
                .getName = getName,
            },
        };
    }

    fn getToken(ptr: *anyopaque, allocator: std.mem.Allocator) OIDCError!OIDCToken {
        _ = ptr;

        const request_url = bun.getenvZ("ACTIONS_ID_TOKEN_REQUEST_URL") orelse return OIDCError.MissingEnvironment;
        const request_token = bun.getenvZ("ACTIONS_ID_TOKEN_REQUEST_TOKEN") orelse return OIDCError.MissingEnvironment;

        // Request with audience parameter for Sigstore
        const url_with_audience = try std.fmt.allocPrint(allocator, "{s}&audience=sigstore", .{request_url});
        defer allocator.free(url_with_audience);
        
        const url = URL.parse(url_with_audience);

        // Set up headers
        var headers: http.HeaderBuilder = .{};
        
        const auth_header = try std.fmt.allocPrint(allocator, "Bearer {s}", .{request_token});
        defer allocator.free(auth_header);
        
        headers.count("authorization", auth_header);
        headers.count("accept", "application/json");

        try headers.allocate(allocator);
        defer headers.deinit();

        headers.append("authorization", auth_header);
        headers.append("accept", "application/json");

        // Prepare response buffer
        var response_buf = try MutableString.init(allocator, 4096);
        defer response_buf.deinit();

        // Make HTTP request
        var req = http.AsyncHTTP.initSync(
            allocator,
            .GET,
            url,
            headers.entries,
            headers.content.ptr.?[0..headers.content.len],
            &response_buf,
            "",
            null,
            null,
            .follow,
        );

        const res = req.sendSync() catch return OIDCError.NetworkError;
        
        if (res.status_code != 200) {
            return OIDCError.TokenAcquisitionFailed;
        }

        // Parse the token response
        var parser = std.json.Parser.init(allocator, .alloc_if_needed);
        defer parser.deinit();

        var tree = parser.parse(response_buf.list.items) catch return OIDCError.InvalidResponse;
        defer tree.deinit();

        if (tree.root != .object) return OIDCError.InvalidResponse;
        const obj = tree.root.object;

        const token_value = obj.get("value") orelse return OIDCError.InvalidResponse;
        if (token_value != .string) return OIDCError.InvalidResponse;

        const token_data = try allocator.dupe(u8, token_value.string);
        
        return OIDCToken{
            .token = token_data,
            .expires_at = std.time.timestamp() + 3600, // 1 hour from now (GitHub Actions tokens are short-lived)
            .audience = try allocator.dupe(u8, "sigstore"),
            .issuer = try allocator.dupe(u8, "https://token.actions.githubusercontent.com"),
            .allocator = allocator,
        };
    }

    fn isSupported(ptr: *anyopaque) bool {
        _ = ptr;
        return bun.getenvZ("ACTIONS_ID_TOKEN_REQUEST_URL") != null and 
               bun.getenvZ("ACTIONS_ID_TOKEN_REQUEST_TOKEN") != null;
    }

    fn getName(ptr: *anyopaque) []const u8 {
        _ = ptr;
        return "github-actions";
    }
};

/// GitLab CI OIDC provider
pub const GitLabCIProvider = struct {
    const Self = @This();

    pub fn init() Self {
        return Self{};
    }

    pub fn provider(self: *Self) OIDCProvider {
        return OIDCProvider{
            .ptr = self,
            .vtable = &.{
                .getToken = getToken,
                .isSupported = isSupported,
                .getName = getName,
            },
        };
    }

    fn getToken(ptr: *anyopaque, allocator: std.mem.Allocator) OIDCError!OIDCToken {
        _ = ptr;

        const sigstore_token = bun.getenvZ("SIGSTORE_ID_TOKEN") orelse return OIDCError.MissingEnvironment;
        
        const token_data = try allocator.dupe(u8, sigstore_token);
        
        return OIDCToken{
            .token = token_data,
            .expires_at = null, // GitLab tokens don't have explicit expiry in env
            .audience = try allocator.dupe(u8, "sigstore"),
            .issuer = try allocator.dupe(u8, "https://gitlab.com"),
            .allocator = allocator,
        };
    }

    fn isSupported(ptr: *anyopaque) bool {
        _ = ptr;
        return bun.getenvZ("SIGSTORE_ID_TOKEN") != null;
    }

    fn getName(ptr: *anyopaque) []const u8 {
        _ = ptr;
        return "gitlab-ci";
    }
};

/// JWT token parser for validation
pub const JWTParser = struct {
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) JWTParser {
        return JWTParser{ .allocator = allocator };
    }

    pub const JWTClaims = struct {
        iss: ?[]const u8 = null, // issuer
        sub: ?[]const u8 = null, // subject  
        aud: ?[]const u8 = null, // audience
        exp: ?i64 = null,        // expiration
        iat: ?i64 = null,        // issued at
        email: ?[]const u8 = null,
        email_verified: ?bool = null,
        
        // GitHub Actions specific
        repository: ?[]const u8 = null,
        workflow: ?[]const u8 = null,
        ref: ?[]const u8 = null,
        sha: ?[]const u8 = null,
        run_id: ?[]const u8 = null,
        run_attempt: ?[]const u8 = null,
        
        // GitLab CI specific  
        project_path: ?[]const u8 = null,
        pipeline_id: ?[]const u8 = null,
        job_id: ?[]const u8 = null,
        ref_type: ?[]const u8 = null,

        allocator: std.mem.Allocator,

        pub fn deinit(self: *JWTClaims) void {
            inline for (std.meta.fields(JWTClaims)) |field| {
                if (field.type == ?[]const u8) {
                    if (@field(self, field.name)) |value| {
                        self.allocator.free(value);
                    }
                }
            }
        }
    };

    pub fn parseToken(self: *JWTParser, token: []const u8) OIDCError!JWTClaims {
        // Split JWT into header.payload.signature
        var parts = std.mem.split(u8, token, ".");
        const header = parts.next() orelse return OIDCError.InvalidToken;
        const payload = parts.next() orelse return OIDCError.InvalidToken;
        const signature = parts.next() orelse return OIDCError.InvalidToken;
        
        _ = header; // Header parsing not needed for basic validation
        _ = signature; // Signature verification would be done against public keys

        // Decode base64 payload
        const decoded_len = try std.base64.url_safe_no_pad.Decoder.calcSizeForSlice(payload);
        const decoded_payload = try self.allocator.alloc(u8, decoded_len);
        defer self.allocator.free(decoded_payload);
        
        try std.base64.url_safe_no_pad.Decoder.decode(decoded_payload, payload);

        // Parse JSON claims
        var claims = JWTClaims{ .allocator = self.allocator };
        
        var parser = std.json.Parser.init(self.allocator, .alloc_if_needed);
        defer parser.deinit();
        
        var tree = parser.parse(decoded_payload) catch return OIDCError.InvalidToken;
        defer tree.deinit();

        if (tree.root != .object) return OIDCError.InvalidToken;
        
        const obj = tree.root.object;
        
        // Extract standard claims
        if (obj.get("iss")) |iss| {
            if (iss == .string) {
                claims.iss = try self.allocator.dupe(u8, iss.string);
            }
        }
        
        if (obj.get("sub")) |sub| {
            if (sub == .string) {
                claims.sub = try self.allocator.dupe(u8, sub.string);
            }
        }
        
        if (obj.get("aud")) |aud| {
            if (aud == .string) {
                claims.aud = try self.allocator.dupe(u8, aud.string);
            }
        }
        
        if (obj.get("exp")) |exp| {
            if (exp == .integer) {
                claims.exp = exp.integer;
            }
        }
        
        if (obj.get("iat")) |iat| {
            if (iat == .integer) {
                claims.iat = iat.integer;
            }
        }

        if (obj.get("email")) |email| {
            if (email == .string) {
                claims.email = try self.allocator.dupe(u8, email.string);
            }
        }

        // GitHub Actions specific claims
        if (obj.get("repository")) |repo| {
            if (repo == .string) {
                claims.repository = try self.allocator.dupe(u8, repo.string);
            }
        }

        return claims;
    }
};

/// Main OIDC token manager
pub const OIDCTokenManager = struct {
    allocator: std.mem.Allocator,
    providers: std.ArrayList(OIDCProvider),
    cached_token: ?OIDCToken = null,

    pub fn init(allocator: std.mem.Allocator) OIDCTokenManager {
        return OIDCTokenManager{
            .allocator = allocator,
            .providers = std.ArrayList(OIDCProvider).init(allocator),
        };
    }

    pub fn deinit(self: *OIDCTokenManager) void {
        if (self.cached_token) |*token| {
            token.deinit();
        }
        self.providers.deinit();
    }

    pub fn addProvider(self: *OIDCTokenManager, provider: OIDCProvider) !void {
        try self.providers.append(provider);
    }

    pub fn getToken(self: *OIDCTokenManager) OIDCError!OIDCToken {
        // Check cached token first
        if (self.cached_token) |*token| {
            if (!token.isExpired()) {
                // Return a copy of the cached token
                return OIDCToken{
                    .token = try self.allocator.dupe(u8, token.token),
                    .expires_at = token.expires_at,
                    .audience = if (token.audience) |aud| try self.allocator.dupe(u8, aud) else null,
                    .issuer = if (token.issuer) |iss| try self.allocator.dupe(u8, iss) else null,
                    .allocator = self.allocator,
                };
            } else {
                // Token expired, clear cache
                token.deinit();
                self.cached_token = null;
            }
        }

        // Try each provider until one works
        for (self.providers.items) |provider| {
            if (provider.isSupported()) {
                if (provider.getToken(self.allocator)) |token| {
                    // Cache the token
                    self.cached_token = OIDCToken{
                        .token = try self.allocator.dupe(u8, token.token),
                        .expires_at = token.expires_at,
                        .audience = if (token.audience) |aud| try self.allocator.dupe(u8, aud) else null,
                        .issuer = if (token.issuer) |iss| try self.allocator.dupe(u8, iss) else null,
                        .allocator = self.allocator,
                    };
                    return token;
                } else |_| {
                    // Provider failed, try next one
                    continue;
                }
            }
        }

        return OIDCError.UnsupportedProvider;
    }

    pub fn detectProvider(self: *OIDCTokenManager) ?[]const u8 {
        for (self.providers.items) |provider| {
            if (provider.isSupported()) {
                return provider.getName();
            }
        }
        return null;
    }
};

// File-scope singletons to avoid use-after-free in createDefaultTokenManager
var GITHUB_ACTIONS_PROVIDER: GitHubActionsProvider = undefined;
var GITLAB_CI_PROVIDER: GitLabCIProvider = undefined;
var providers_initialized = false;

/// Initialize default OIDC token manager with standard providers
pub fn createDefaultTokenManager(allocator: std.mem.Allocator) !OIDCTokenManager {
    var manager = OIDCTokenManager.init(allocator);
    
    if (!providers_initialized) {
        GITHUB_ACTIONS_PROVIDER = GitHubActionsProvider.init();
        GITLAB_CI_PROVIDER = GitLabCIProvider.init();
        providers_initialized = true;
    }
    
    try manager.addProvider(GITHUB_ACTIONS_PROVIDER.provider());
    try manager.addProvider(GITLAB_CI_PROVIDER.provider());
    
    return manager;
}