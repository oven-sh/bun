import * as b from "../../codegen/bindgen-lib.ts";

export const FileSystemRouterOptions = b.dictionary(
  {
    style: b.string.loose.utf8.optional,
    dir: b.string.utf8,
    fileExtensions: b.array(b.string.utf8.owned).optional,
    assetPrefix: b.string.utf8.nullable,
    origin: b.string.utf8.optional,
  },
  { allowArray: true },
);

const text = { getter: b.string.utf8, cache: true } as const;
const record = { getter: b.any, cache: true, capability: "heap", throws: true } as const;

export const RouteKind = b.enumeration(["exact", "catch-all", "optional-catch-all", "dynamic"]);

export const MatchedRoute = b.class({
  rustPath: "crate::api::filesystem_router::MatchedRoute",
  configurable: false,
  proto: {
    filePath: text,
    kind: { getter: RouteKind },
    name: text,
    params: record,
    pathname: text,
    query: record,
    /** `src`, for old versions of bun-framework-next. */
    scriptSrc: { ...text, cache: "src" },
    src: text,
  },
});

export const Routable = b.union({
  path: b.string.allowStringObject,
  request: b.classRef("Request"),
  response: b.classRef("Response"),
});

export const FileSystemRouter = b.class({
  rustPath: "crate::api::filesystem_router::FileSystemRouter",
  configurable: false,
  construct: {
    args: { options: FileSystemRouterOptions },
    expected: { options: "Expected object" },
    capability: "js",
    throws: true,
    length: 0,
  },
  proto: {
    assetPrefix: { getter: b.string.utf8.nullable },
    match: {
      args: { input: Routable },
      expected: { input: "Expected string, Request or Response" },
      returns: MatchedRoute.nullable,
      capability: "heap",
      throws: true,
      mutates: true,
    },
    origin: { getter: b.string.utf8.nullable, cache: true },
    reload: { returns: b.self, capability: "js", throws: true },
    routes: record,
    style: { getter: b.string },
  },
});
