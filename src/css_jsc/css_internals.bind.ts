import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::css_internals" });

/** `options` is the browser targets, or the parser's options for a `WithOptions` function. */
const stylesheetTest = () =>
  b.fn({
    args: { source: b.string.allowStringObject, expected: b.string.allowStringObject, options: b.any },
    returns: b.any,
    capability: "js",
    throws: true,
  });

export const minifyTestWithOptions = stylesheetTest();
export const minifyErrorTestWithOptions = stylesheetTest();
export const testWithOptions = stylesheetTest();
export const prefixTestWithOptions = stylesheetTest();
export const minifyTest = stylesheetTest();
export const prefixTest = stylesheetTest();
export const test = stylesheetTest();

export const attrTest = b.fn({
  args: { source: b.string.allowStringObject, expected: b.string.allowStringObject, minify: b.any, targets: b.any },
  returns: b.any,
  capability: "js",
  throws: true,
  length: 3,
});
