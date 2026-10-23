import * as b from "../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::css_internals" });

const version = b.u32.emptyStringAsNull;
export const BrowserTargets = b.dictionary({
  android: version,
  chrome: version,
  edge: version,
  firefox: version,
  ie: version,
  ios_saf: version,
  opera: version,
  safari: version,
  samsung: version,
});

export const CssParserFlag = b.enumeration(["DEEP_SELECTOR_COMBINATOR"]);
export const CssParserOptions = b.dictionary({ flags: b.array(CssParserFlag).emptyStringAsNull });

/** `failure` is what the parser logged, as an error that is not thrown, or `undefined` if an attribute cannot be printed. */
export const CssTestOutput = b.union({ code: b.string.utf8, failure: b.any });

const stylesheetTest = (options: b.Type) =>
  b.fn({
    args: { source: b.string.utf8, expected: b.string.utf8, options },
    returns: CssTestOutput,
    capability: "js",
    throws: true,
    length: 3,
  });

export const minifyTestWithOptions = stylesheetTest(CssParserOptions.nullable);
export const minifyErrorTestWithOptions = stylesheetTest(CssParserOptions.nullable);
export const testWithOptions = stylesheetTest(CssParserOptions.nullable);
export const prefixTestWithOptions = stylesheetTest(CssParserOptions.nullable);
export const minifyTest = stylesheetTest(BrowserTargets.nullable);
export const prefixTest = stylesheetTest(BrowserTargets.nullable);
export const test = stylesheetTest(BrowserTargets.nullable);

export const attrTest = b.fn({
  args: {
    source: b.string.utf8,
    expected: b.string.utf8,
    minify: b.bool.default(false),
    targets: BrowserTargets.nullable,
  },
  returns: CssTestOutput,
  capability: "js",
  throws: true,
  length: 3,
});
