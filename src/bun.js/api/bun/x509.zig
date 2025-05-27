const BoringSSL = bun.BoringSSL.c;
const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

pub inline fn isSafeAltName(name: []const u8, utf8: bool) bool {
    for (name) |c| {
        switch (c) {
            '"',
            '\\',
            // These mess with encoding rules.
            // Fall through.
            ',',
            // Commas make it impossible to split the list of subject alternative
            // names unambiguously, which is why we have to escape.
            // Fall through.
            '\'',
            => {
                // Single quotes are unlikely to appear in any legitimate values, but they
                // could be used to make a value look like it was escaped (i.e., enclosed
                // in single/double quotes).
                return false;
            },
            else => {
                if (utf8) {
                    // In UTF8 strings, we require escaping for any ASCII control character,
                    // but NOT for non-ASCII characters. Note that all bytes of any code
                    // point that consists of more than a single byte have their MSB set.
                    if (c < ' ' or c == '\x7f') {
                        return false;
                    }
                } else {
                    // Check if the char is a control character or non-ASCII character. Note
                    // that char may or may not be a signed type. Regardless, non-ASCII
                    // values will always be outside of this range.
                    if (c < ' ' or c > '~') {
                        return false;
                    }
                }
            },
        }
    }
    return true;
}

pub fn toJS(cert: *BoringSSL.X509, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    return Bun__X509__toJSLegacyEncoding(cert, globalObject);
}

pub fn toJSObject(cert: *BoringSSL.X509, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    return Bun__X509__toJS(cert, globalObject);
}

extern fn Bun__X509__toJSLegacyEncoding(cert: *BoringSSL.X509, globalObject: *JSGlobalObject) JSValue;
extern fn Bun__X509__toJS(cert: *BoringSSL.X509, globalObject: *JSGlobalObject) JSValue;
