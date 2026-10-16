import * as b from "../../codegen/bindgen-lib.ts";

/** `undefined` if `arg` is the path of a page, else the pages that match the pattern `arg`. A relative path is in `cwd`. */
export const pagesOf = b.fn({
  args: { arg: b.string.utf8, cwd: b.string.utf8 },
  returns: b.array(b.string.utf8).optional,
  throws: true,
  rustPath: "crate::cli::html_pages::pages_of_from_js",
});
