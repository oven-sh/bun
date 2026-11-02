import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::node::node_util_binding" });

export const internalErrorName = b.fn({ args: { err: b.f64 }, returns: b.string });

export const UVError = b.dictionary({ code: b.i32, name: b.string });
export const internalErrorEntries = b.fn({ returns: b.array(UVError) });

export const etimedoutErrorCode = b.fn({ returns: b.i32 });
export const enobufsErrorCode = b.fn({ returns: b.i32 });
export const ecanceledErrorCode = b.value({ returns: b.i32 });
export const uvTranslateSysError = b.fn({ args: { errno: b.f64 }, returns: b.i32 });

export const extractedSplitNewLinesFastPathStringsOnly = b.fn({
  args: { value: b.string },
  returns: b.array(b.string).optional,
});

export const normalizeEncoding = b.fn({
  args: { encoding: b.string.loose },
  returns: b.any,
  capability: "heap",
});

export const assertEncodingValid = b.fn({
  args: { encoding: b.any },
  capability: "js",
  throws: true,
  rustPath: "crate::node::types::assert_encoding_valid",
});

export const parseEnv = b.fn({
  args: { content: b.string.utf8 },
  expected: { content: ["string"] },
  returns: b.any,
  capability: "heap",
  throws: true,
});
