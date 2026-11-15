import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::headers_jsc" });

export const H2LiveCounts = b.dictionary({ sessions: b.i32, streams: b.i32 });
export const h2LiveCounts = b.fn({ returns: H2LiveCounts });

export const H3LiveCounts = b.dictionary({ sessions: b.u32, streams: b.u32 });
export const h3LiveCounts = b.fn({ returns: H3LiveCounts });
