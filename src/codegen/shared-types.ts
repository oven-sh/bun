export const typeDeclarations = `
const bun = @import("bun");
const JSC = bun.JSC;
const HTTPServerAgent = bun.jsc.Debugger.HTTPServerAgent;
`;

export const sharedTypes: Record<string, string> = {
  // Basic types
  "void": "void",
  "bool": "bool",
  "char": "u8",
  "unsigned char": "u8",
  "signed char": "i8",
  "short": "i16",
  "unsigned short": "u16",
  "int": "c_int",
  "unsigned int": "c_uint",
  "long": "c_long",
  "unsigned long": "c_ulong",
  "long long": "i64",
  "unsigned long long": "u64",
  "float": "f32",
  "double": "f64",
  "size_t": "usize",
  "ssize_t": "isize",
  "int8_t": "i8",
  "uint8_t": "u8",
  "int16_t": "i16",
  "uint16_t": "u16",
  "int32_t": "i32",
  "uint32_t": "u32",
  "int64_t": "i64",
  "uint64_t": "u64",

  // Common Bun types
  "BunString": "bun.String",
  "JSC::EncodedJSValue": "JSC.JSValue",
  "JSC::JSGlobalObject": "JSC.JSGlobalObject",
  "ZigException": "bun.JSC.ZigException",
  "Inspector::InspectorHTTPServerAgent": "HTTPServerAgent.InspectorHTTPServerAgent",
  "HotReloadId": "HTTPServerAgent.HotReloadId",
};
