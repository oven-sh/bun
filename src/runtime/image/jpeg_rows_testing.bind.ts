import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::image::jpeg_rows_testing" });

// The wrappers of src/highway/jpeg.rs. A number is the length of an output row, in the elements of its slice.

const row = b.bytes({ from: ["buffer"] });
/** Whether the wrapper did the work, then its output rows one after the other, 0xa5 where nothing was written. */
const answer = { returns: b.bufferSource, capability: "heap", throws: true } as const;

/** `out` holds `before` pixels and has room for `room` more. */
export const fromYcc = b.fn({
  ...answer,
  args: { y: row, cb: row, cr: row, k: row.nullable, before: b.u16, room: b.u16 },
});
export const toYcc = b.fn({ ...answer, args: { rgba: row, y: b.u16, cb: b.u16, cr: b.u16 } });
export const h2v2Downsample = b.fn({ ...answer, args: { row0: row, row1: row, out: b.u16 } });
export const h2v1Fancy = b.fn({ ...answer, args: { input: row, out: b.u16 } });
export const h2v2Fancy = b.fn({ ...answer, args: { near: row, far: row, out: b.u16 } });
