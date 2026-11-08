import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::node::util::parse_args" });

/** New objects and lists, `values` without a prototype. A `default` comes back as the program handed it in: it may be a list of a class of its own. */
export const parseArgs = b.fn({
  args: { config: b.any },
  returns: b.any.returning(table.anyMadeOf("Object", "Array").spec),
  capability: "js",
  throws: true,
});
