const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const Crypto = JSC.API.Bun.Crypto;
const BoringSSL = bun.BoringSSL;
const assert = bun.assert;
const JSValue = JSC.JSValue;

extern "c" fn Bun__DiffieHellmanConstructor(*JSC.JSGlobalObject) JSC.JSValue;
extern "c" fn Bun__DiffieHellmanGroupConstructor(*JSC.JSGlobalObject) JSC.JSValue;

pub fn createNodeCryptoDHBinding(global: *JSC.JSGlobalObject) JSC.JSValue {
    const crypto = JSC.JSValue.createEmptyObject(global, 2);

    // Add constructors
    crypto.put(global, bun.String.init("DiffieHellman"), Bun__DiffieHellmanConstructor(global));
    crypto.put(global, bun.String.init("DiffieHellmanGroup"), Bun__DiffieHellmanGroupConstructor(global));

    return crypto;
}
