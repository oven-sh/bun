import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::util::parse_args" });

/** New objects and lists, `values` without a prototype. An element of `args` and a `default` come back as the program handed them in, of whatever class. */
export const parseArgs = b.fn({
  args: { config: b.any },
  returns: b.any.returning(table.anyMadeOf("Object", "Array").spec),
  capability: "js",
  throws: true,
});
