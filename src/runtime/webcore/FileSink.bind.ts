import * as b from "../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::webcore::file_sink" });

/** POSIX. `Bun.file(fd).writer()` for an `fs.WriteStream`: the sink also opens when the event loop refuses the fd. */
export const openForStream = b.fn({
  args: { fd: b.i32.validateInteger(0, 2 ** 31 - 1) },
  returns: b.any,
  capability: "js",
  throws: true,
});
