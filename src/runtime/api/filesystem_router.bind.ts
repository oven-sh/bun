import * as b from "../../codegen/bindgen-lib.ts";
import { Request, Response } from "../webcore/response.bind.ts";

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
const queryObject = { getter: b.any.returning("object"), cache: true, capability: "heap", throws: true } as const;

export const RouteKind = b.enumeration(["exact", "catch-all", "optional-catch-all", "dynamic"]);

export const MatchedRoute = b.class({
  rustPath: "crate::api::filesystem_router::MatchedRoute",
  proto: {
    filePath: text,
    kind: { getter: RouteKind, cache: true },
    name: text,
    params: queryObject,
    pathname: text,
    query: queryObject,
    /** `src`, for old versions of bun-framework-next. */
    scriptSrc: text,
    src: { ...text, cache: "scriptSrc" },
  },
});

export const Routable = b.union({
  path: b.string.allowStringObject,
  request: Request,
  response: Response,
});

export const RouterStyle = b.enumeration(["nextjs"]);

export const FileSystemRouter = b.class({
  rustPath: "crate::api::filesystem_router::FileSystemRouter",
  construct: {
    args: { options: FileSystemRouterOptions },
    expected: { options: "Expected object" },
    capability: "js",
    throws: true,
    length: 0,
  },
  proto: {
    assetPrefix: { getter: b.string.utf8.nullable, cache: true },
    match: {
      args: { input: Routable },
      expected: { input: "Expected string, Request or Response" },
      returns: MatchedRoute.nullable,
      capability: "heap",
      throws: true,
    },
    origin: { getter: b.string.utf8.nullable, cache: true },
    reload: { returns: b.self, capability: "js", throws: true, passThis: true },
    routes: { getter: b.record(b.string.utf8), cache: true },
    style: { getter: RouterStyle, cache: true },
  },
});

/** `frameworkRouterInternals.FrameworkRouter` of `bun:internal-for-testing`. */
export const FrameworkFileSystemRouter = b.class({
  rustPath: "crate::bake::router::JSFrameworkRouter",
  construct: { args: { options: b.any }, capability: "js", throws: true, length: 0 },
  proto: {
    match: {
      args: { path: b.string.loose.utf8 },
      returns: b.any.returning("object", "null"),
      capability: "js",
      throws: true,
    },
    toJSON: { returns: b.any.returning("object"), capability: "js", throws: true },
  },
});
