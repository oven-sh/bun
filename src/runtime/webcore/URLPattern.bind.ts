import * as b from "../../codegen/bindgen-lib.ts";

export const URLPatternInit = b.dictionary(
  {
    baseURL: b.string.usv.optional,
    hash: b.string.usv.optional,
    hostname: b.string.usv.optional,
    password: b.string.usv.optional,
    pathname: b.string.usv.optional,
    port: b.string.usv.optional,
    protocol: b.string.usv.optional,
    search: b.string.usv.optional,
    username: b.string.usv.optional,
  },
  { webIDL: true, toJS: true },
);

export const URLPatternInput = b.union({ init: URLPatternInit, string: b.string.usv });

export const URLPatternOptions = b.dictionary({ ignoreCase: b.bool.loose.default(false) }, { webIDL: true });

export const URLPatternComponentResult = b.dictionary({ input: b.string.local, groups: b.object });

export const URLPatternResult = b.dictionary({
  inputs: b.jsArray,
  protocol: URLPatternComponentResult,
  username: URLPatternComponentResult,
  password: URLPatternComponentResult,
  hostname: URLPatternComponentResult,
  port: URLPatternComponentResult,
  pathname: URLPatternComponentResult,
  search: URLPatternComponentResult,
  hash: URLPatternComponentResult,
});

const RegExp = b.cell("JSC::RegExp", "JavaScriptCore/RegExp.h", "bindgen::JsRegExp<'a>");

const input = URLPatternInput.nullable;
const options = URLPatternOptions.nullable.default({});
const constructs = { capability: "heap", throws: true, passStructure: true, fresh: true } as const;
const matches = {
  args: { input, baseURL: b.string.usv.optional },
  capability: "heap",
  throws: true,
  passThis: true,
} as const;

export const URLPattern = b.class({
  rustPath: "crate::webcore::URLPattern",
  webIDL: true,
  construct: [
    { args: { input, options }, ...constructs },
    { args: { input, baseURL: b.string.usv.owned, options }, ...constructs, rustName: "constructor_with_base_url" },
  ],
  internalFields: {
    protocolRegExp: RegExp,
    usernameRegExp: RegExp,
    passwordRegExp: RegExp,
    hostnameRegExp: RegExp,
    portRegExp: RegExp,
    pathnameRegExp: RegExp,
    searchRegExp: RegExp,
    hashRegExp: RegExp,
  },
  proto: {
    protocol: { getter: b.string, cache: true },
    username: { getter: b.string, cache: true },
    password: { getter: b.string, cache: true },
    hostname: { getter: b.string, cache: true },
    port: { getter: b.string, cache: true },
    pathname: { getter: b.string, cache: true },
    search: { getter: b.string, cache: true },
    hash: { getter: b.string, cache: true },
    hasRegExpGroups: { getter: b.bool, pure: true },
    test: { ...matches, returns: b.bool },
    exec: { ...matches, returns: URLPatternResult.nullable },
  },
});
