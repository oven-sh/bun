/// Check if a registry URL is a GitLab registry by examining the hostname
pub fn isGitLabRegistry(registry_url: []const u8) bool {
    const url = bun.URL.parse(registry_url);
    if (url.host.len == 0) return false;
    const host_buf = bun.default_allocator.alloc(u8, url.host.len) catch return false;
    defer bun.default_allocator.free(host_buf);
    const host = strings.copyLowercase(url.host, host_buf);
    return strings.indexOf(host, "gitlab") != null;
}

/// Registry utilities for package managers
const strings = bun.strings;

const std = @import("std");
const bun = @import("bun");