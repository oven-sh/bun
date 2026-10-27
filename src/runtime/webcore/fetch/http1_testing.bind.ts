import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::fetch::http1_testing" });

export const parseResponse = b.fn({
  args: { data: b.bytes({ from: ["buffer"] }), slots: b.usize },
  returns: b.string.utf8,
});

export const receiveResponse = b.fn({
  args: { data: b.bytes({ from: ["buffer"] }), slots: b.usize, piece: b.usize },
  returns: b.string.utf8,
});

export const headBytesRead = b.fn({ returns: b.usize });

export const decodeChunked = b.fn({
  args: { data: b.bytes({ from: ["buffer"] }), cuts: b.array(b.usize) },
  returns: b.string.utf8,
});
