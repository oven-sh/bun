const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;

// macOS Security framework function pointers
pub const SecTrustCopyAnchorCertificatesFunc = *const fn (*?*anyopaque) callconv(.C) c_int;
pub const SecCertificateCopyDataFunc = *const fn (?*anyopaque) callconv(.C) ?*anyopaque;

// CoreFoundation function pointers  
pub const CFArrayGetCountFunc = *const fn (?*anyopaque) callconv(.C) c_long;
pub const CFArrayGetValueAtIndexFunc = *const fn (?*anyopaque, c_long) callconv(.C) ?*anyopaque;
pub const CFDataGetBytePtrFunc = *const fn (?*anyopaque) callconv(.C) [*]const u8;
pub const CFDataGetLengthFunc = *const fn (?*anyopaque) callconv(.C) c_long;
pub const CFReleaseFunc = *const fn (?*anyopaque) callconv(.C) void;

// Structure to hold all the function pointers
pub const MacOSCAFunctions = extern struct {
    SecTrustCopyAnchorCertificates: ?SecTrustCopyAnchorCertificatesFunc,
    SecCertificateCopyData: ?SecCertificateCopyDataFunc,
    CFArrayGetCount: ?CFArrayGetCountFunc,
    CFArrayGetValueAtIndex: ?CFArrayGetValueAtIndexFunc,
    CFDataGetBytePtr: ?CFDataGetBytePtrFunc,
    CFDataGetLength: ?CFDataGetLengthFunc,
    CFRelease: ?CFReleaseFunc,
};

var ca_functions: ?MacOSCAFunctions = null;
var init_mutex: std.Thread.Mutex = .{};

fn dlsym(handle: ?*anyopaque, comptime Type: type, comptime symbol: [:0]const u8) ?Type {
    if (std.c.dlsym(handle, symbol)) |ptr| {
        return bun.cast(Type, ptr);
    }
    return null;
}

fn initMacOSCAFunctions() bool {
    if (ca_functions != null) return true;
    
    init_mutex.lock();
    defer init_mutex.unlock();
    
    if (ca_functions != null) return true;
    
    if (!Environment.isMac) return false;
    
    // Load Security framework
    const security_handle = bun.sys.dlopen("/System/Library/Frameworks/Security.framework/Security", .{ .LAZY = true, .LOCAL = true });
    if (security_handle == null) return false;
    
    // Load CoreFoundation framework  
    const cf_handle = bun.sys.dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", .{ .LAZY = true, .LOCAL = true });
    if (cf_handle == null) return false;
    
    ca_functions = MacOSCAFunctions{
        .SecTrustCopyAnchorCertificates = dlsym(security_handle, SecTrustCopyAnchorCertificatesFunc, "SecTrustCopyAnchorCertificates"),
        .SecCertificateCopyData = dlsym(security_handle, SecCertificateCopyDataFunc, "SecCertificateCopyData"),
        .CFArrayGetCount = dlsym(cf_handle, CFArrayGetCountFunc, "CFArrayGetCount"),
        .CFArrayGetValueAtIndex = dlsym(cf_handle, CFArrayGetValueAtIndexFunc, "CFArrayGetValueAtIndex"),
        .CFDataGetBytePtr = dlsym(cf_handle, CFDataGetBytePtrFunc, "CFDataGetBytePtr"),
        .CFDataGetLength = dlsym(cf_handle, CFDataGetLengthFunc, "CFDataGetLength"),
        .CFRelease = dlsym(cf_handle, CFReleaseFunc, "CFRelease"),
    };
    
    // Verify all functions were loaded
    if (ca_functions.?.SecTrustCopyAnchorCertificates == null or
        ca_functions.?.SecCertificateCopyData == null or
        ca_functions.?.CFArrayGetCount == null or
        ca_functions.?.CFArrayGetValueAtIndex == null or
        ca_functions.?.CFDataGetBytePtr == null or
        ca_functions.?.CFDataGetLength == null or
        ca_functions.?.CFRelease == null)
    {
        ca_functions = null;
        return false;
    }
    
    return true;
}

// Export function to get the CA functions for C++
export fn Bun__getMacOSCAFunctions() ?*MacOSCAFunctions {
    if (initMacOSCAFunctions()) {
        return &ca_functions.?;
    }
    return null;
}

// Check if system CA loading is enabled
export fn Bun__useSystemCA() c_int {
    // Check environment variable
    const env_var = std.process.getEnvVarOwned(bun.default_allocator, "BUN_USE_SYSTEM_CA") catch return 0;
    defer bun.default_allocator.free(env_var);
    
    // Return 1 if the environment variable is set to "1" or "true"
    if (std.mem.eql(u8, env_var, "1") or std.mem.eql(u8, env_var, "true")) {
        return 1;
    }
    
    return 0;
}