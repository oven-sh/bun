const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;

// macOS Security framework types
pub const OSStatus = c_int;
pub const CFIndex = c_long;
pub const Boolean = c_uchar;

// Opaque types
pub const CFTypeRef = ?*anyopaque;
pub const CFArrayRef = ?*anyopaque;
pub const CFDataRef = ?*anyopaque;
pub const CFStringRef = ?*anyopaque;
pub const CFDictionaryRef = ?*anyopaque;
pub const CFErrorRef = ?*anyopaque;
pub const CFAllocatorRef = ?*anyopaque;
pub const SecCertificateRef = ?*anyopaque;
pub const SecTrustRef = ?*anyopaque;
pub const SecPolicyRef = ?*anyopaque;

// Security framework function pointers
pub const SecTrustCopyAnchorCertificatesFunc = *const fn (*?CFArrayRef) callconv(.C) OSStatus;
pub const SecCertificateCopyDataFunc = *const fn (SecCertificateRef) callconv(.C) CFDataRef;
pub const SecItemCopyMatchingFunc = *const fn (CFDictionaryRef, *?CFTypeRef) callconv(.C) OSStatus;
pub const SecTrustSettingsCopyTrustSettingsFunc = *const fn (SecCertificateRef, c_int) callconv(.C) OSStatus;
pub const SecPolicyCreateSSLFunc = *const fn (Boolean, CFStringRef) callconv(.C) SecPolicyRef;
pub const SecTrustCreateWithCertificatesFunc = *const fn (CFTypeRef, CFTypeRef, *?SecTrustRef) callconv(.C) OSStatus;
pub const SecTrustEvaluateWithErrorFunc = *const fn (SecTrustRef, *?CFErrorRef) callconv(.C) Boolean;
pub const SecPolicyCopyPropertiesFunc = *const fn (SecPolicyRef) callconv(.C) CFDictionaryRef;

// CoreFoundation function pointers  
pub const CFArrayGetCountFunc = *const fn (CFArrayRef) callconv(.C) CFIndex;
pub const CFArrayGetValueAtIndexFunc = *const fn (CFArrayRef, CFIndex) callconv(.C) CFTypeRef;
pub const CFDataGetBytePtrFunc = *const fn (CFDataRef) callconv(.C) [*]const u8;
pub const CFDataGetLengthFunc = *const fn (CFDataRef) callconv(.C) CFIndex;
pub const CFReleaseFunc = *const fn (CFTypeRef) callconv(.C) void;
pub const CFDictionaryCreateFunc = *const fn (CFAllocatorRef, [*]CFTypeRef, [*]CFTypeRef, CFIndex, ?*anyopaque, ?*anyopaque) callconv(.C) CFDictionaryRef;
pub const CFStringCreateWithCStringFunc = *const fn (CFAllocatorRef, [*:0]const u8, c_uint) callconv(.C) CFStringRef;
pub const CFArrayCreateFunc = *const fn (CFAllocatorRef, [*]CFTypeRef, CFIndex, ?*anyopaque) callconv(.C) CFArrayRef;
pub const CFDictionaryGetValueFunc = *const fn (CFDictionaryRef, CFTypeRef) callconv(.C) CFTypeRef;
pub const CFGetTypeIDFunc = *const fn (CFTypeRef) callconv(.C) c_ulong;
pub const CFStringGetTypeIDFunc = *const fn () callconv(.C) c_ulong;
pub const CFNumberGetTypeIDFunc = *const fn () callconv(.C) c_ulong;
pub const CFStringGetCStringFunc = *const fn (CFStringRef, [*]u8, CFIndex, c_uint) callconv(.C) Boolean;
pub const CFNumberGetValueFunc = *const fn (CFTypeRef, c_int, *anyopaque) callconv(.C) Boolean;

// Constants that need to be resolved dynamically
pub const ConstantRef = ?*CFStringRef;

// Structure to hold all the function pointers and constants
pub const MacOSCAFunctions = extern struct {
    // Security framework functions
    SecTrustCopyAnchorCertificates: ?SecTrustCopyAnchorCertificatesFunc,
    SecCertificateCopyData: ?SecCertificateCopyDataFunc,
    SecItemCopyMatching: ?SecItemCopyMatchingFunc,
    SecTrustSettingsCopyTrustSettings: ?SecTrustSettingsCopyTrustSettingsFunc,
    SecPolicyCreateSSL: ?SecPolicyCreateSSLFunc,
    SecTrustCreateWithCertificates: ?SecTrustCreateWithCertificatesFunc,
    SecTrustEvaluateWithError: ?SecTrustEvaluateWithErrorFunc,
    SecPolicyCopyProperties: ?SecPolicyCopyPropertiesFunc,
    
    // CoreFoundation functions
    CFArrayGetCount: ?CFArrayGetCountFunc,
    CFArrayGetValueAtIndex: ?CFArrayGetValueAtIndexFunc,
    CFDataGetBytePtr: ?CFDataGetBytePtrFunc,
    CFDataGetLength: ?CFDataGetLengthFunc,
    CFRelease: ?CFReleaseFunc,
    CFDictionaryCreate: ?CFDictionaryCreateFunc,
    CFStringCreateWithCString: ?CFStringCreateWithCStringFunc,
    CFArrayCreate: ?CFArrayCreateFunc,
    CFDictionaryGetValue: ?CFDictionaryGetValueFunc,
    CFGetTypeID: ?CFGetTypeIDFunc,
    CFStringGetTypeID: ?CFStringGetTypeIDFunc,
    CFNumberGetTypeID: ?CFNumberGetTypeIDFunc,
    CFStringGetCString: ?CFStringGetCStringFunc,
    CFNumberGetValue: ?CFNumberGetValueFunc,
    
    // Constants
    kSecClass: ConstantRef,
    kSecClassCertificate: ConstantRef,
    kSecMatchLimit: ConstantRef,
    kSecMatchLimitAll: ConstantRef,
    kSecReturnRef: ConstantRef,
    kCFBooleanTrue: ConstantRef,
    kSecTrustSettingsResult: ConstantRef,
    kSecTrustSettingsPolicy: ConstantRef,
    kSecTrustSettingsPolicyString: ConstantRef,
    kSecTrustSettingsApplication: ConstantRef,
    kSecPolicyOid: ConstantRef,
    kSecPolicyAppleSSL: ConstantRef,
};

var ca_functions: ?MacOSCAFunctions = null;
var init_mutex: std.Thread.Mutex = .{};

fn dlsym(handle: ?*anyopaque, comptime Type: type, comptime symbol: [:0]const u8) ?Type {
    if (std.c.dlsym(handle, symbol)) |ptr| {
        return bun.cast(Type, ptr);
    }
    return null;
}

fn dlsym_constant(handle: ?*anyopaque, comptime symbol: [:0]const u8) ConstantRef {
    if (std.c.dlsym(handle, symbol)) |ptr| {
        return bun.cast(ConstantRef, ptr);
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
        // Security framework functions
        .SecTrustCopyAnchorCertificates = dlsym(security_handle, SecTrustCopyAnchorCertificatesFunc, "SecTrustCopyAnchorCertificates"),
        .SecCertificateCopyData = dlsym(security_handle, SecCertificateCopyDataFunc, "SecCertificateCopyData"),
        .SecItemCopyMatching = dlsym(security_handle, SecItemCopyMatchingFunc, "SecItemCopyMatching"),
        .SecTrustSettingsCopyTrustSettings = dlsym(security_handle, SecTrustSettingsCopyTrustSettingsFunc, "SecTrustSettingsCopyTrustSettings"),
        .SecPolicyCreateSSL = dlsym(security_handle, SecPolicyCreateSSLFunc, "SecPolicyCreateSSL"),
        .SecTrustCreateWithCertificates = dlsym(security_handle, SecTrustCreateWithCertificatesFunc, "SecTrustCreateWithCertificates"),
        .SecTrustEvaluateWithError = dlsym(security_handle, SecTrustEvaluateWithErrorFunc, "SecTrustEvaluateWithError"),
        .SecPolicyCopyProperties = dlsym(security_handle, SecPolicyCopyPropertiesFunc, "SecPolicyCopyProperties"),
        
        // CoreFoundation functions
        .CFArrayGetCount = dlsym(cf_handle, CFArrayGetCountFunc, "CFArrayGetCount"),
        .CFArrayGetValueAtIndex = dlsym(cf_handle, CFArrayGetValueAtIndexFunc, "CFArrayGetValueAtIndex"),
        .CFDataGetBytePtr = dlsym(cf_handle, CFDataGetBytePtrFunc, "CFDataGetBytePtr"),
        .CFDataGetLength = dlsym(cf_handle, CFDataGetLengthFunc, "CFDataGetLength"),
        .CFRelease = dlsym(cf_handle, CFReleaseFunc, "CFRelease"),
        .CFDictionaryCreate = dlsym(cf_handle, CFDictionaryCreateFunc, "CFDictionaryCreate"),
        .CFStringCreateWithCString = dlsym(cf_handle, CFStringCreateWithCStringFunc, "CFStringCreateWithCString"),
        .CFArrayCreate = dlsym(cf_handle, CFArrayCreateFunc, "CFArrayCreate"),
        .CFDictionaryGetValue = dlsym(cf_handle, CFDictionaryGetValueFunc, "CFDictionaryGetValue"),
        .CFGetTypeID = dlsym(cf_handle, CFGetTypeIDFunc, "CFGetTypeID"),
        .CFStringGetTypeID = dlsym(cf_handle, CFStringGetTypeIDFunc, "CFStringGetTypeID"),
        .CFNumberGetTypeID = dlsym(cf_handle, CFNumberGetTypeIDFunc, "CFNumberGetTypeID"),
        .CFStringGetCString = dlsym(cf_handle, CFStringGetCStringFunc, "CFStringGetCString"),
        .CFNumberGetValue = dlsym(cf_handle, CFNumberGetValueFunc, "CFNumberGetValue"),
        
        // Constants
        .kSecClass = dlsym_constant(security_handle, "kSecClass"),
        .kSecClassCertificate = dlsym_constant(security_handle, "kSecClassCertificate"),
        .kSecMatchLimit = dlsym_constant(security_handle, "kSecMatchLimit"),
        .kSecMatchLimitAll = dlsym_constant(security_handle, "kSecMatchLimitAll"),
        .kSecReturnRef = dlsym_constant(security_handle, "kSecReturnRef"),
        .kCFBooleanTrue = dlsym_constant(cf_handle, "kCFBooleanTrue"),
        .kSecTrustSettingsResult = dlsym_constant(security_handle, "kSecTrustSettingsResult"),
        .kSecTrustSettingsPolicy = dlsym_constant(security_handle, "kSecTrustSettingsPolicy"),
        .kSecTrustSettingsPolicyString = dlsym_constant(security_handle, "kSecTrustSettingsPolicyString"),
        .kSecTrustSettingsApplication = dlsym_constant(security_handle, "kSecTrustSettingsApplication"),
        .kSecPolicyOid = dlsym_constant(security_handle, "kSecPolicyOid"),
        .kSecPolicyAppleSSL = dlsym_constant(security_handle, "kSecPolicyAppleSSL"),
    };
    
    // Verify critical functions were loaded
    if (ca_functions.?.SecCertificateCopyData == null or
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

// External function to check CLI flag
extern "C" fn Bun__useSystemCAFromCLI() c_int;

// Check if system CA loading is enabled
export fn Bun__useSystemCA() c_int {
    // First check CLI flag
    if (Bun__useSystemCAFromCLI() == 1) {
        return 1;
    }
    
    // Fallback to environment variable for backward compatibility
    const env_var = std.process.getEnvVarOwned(bun.default_allocator, "BUN_USE_SYSTEM_CA") catch return 0;
    defer bun.default_allocator.free(env_var);
    
    // Return 1 if the environment variable is set to "1" or "true"
    if (std.mem.eql(u8, env_var, "1") or std.mem.eql(u8, env_var, "true")) {
        return 1;
    }
    
    return 0;
}