import * as b from "../../codegen/bindgen-lib.ts";
import { FileSink } from "../webcore/Sink.bind.ts";

export default b.module({ rustPath: "crate::node::node_process" });

/** `process.stdout._handle.setBlocking(blocking)`. Returns 0 or a negative errno. `sink` is what the stream writes through. */
export const setStdioBlocking = b.fn({
  args: { fd: b.i32, blocking: b.bool, sink: FileSink.otherAsNull },
  returns: b.i32,
});
