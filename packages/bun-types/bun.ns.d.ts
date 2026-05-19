// Re-expose the ambient `"bun"` module under an internal name so that the
// namespace alias below doesn't have to resolve `"bun"` by module lookup.
//
// Historical context: the old version of this file did
//
//   import * as BunModule from "bun";
//   declare global { export import Bun = BunModule; }
//
// which is the TypeScript-idiomatic way to alias an ambient module to a global
// namespace. The trouble is that when a project also has `@types/bun` installed
// (the DefinitelyTyped stub — a single `/// <reference types="bun-types" />`),
// TypeScript 6's tighter module resolution resolves `"bun"` here to that stub
// file, not to the ambient `declare module "bun"` block in `bun.d.ts`. The
// stub has no declarations, so `BunModule` becomes an empty namespace and the
// global `Bun` loses all its members.
//
// Using an identifier that contains `:` makes TypeScript treat it as an
// absolute URI and skip file-based module resolution — only ambient module
// declarations are considered. The `declare module "bun-types:internal"`
// block in `bun.d.ts` re-exports the ambient `"bun"` module, and we import
// from that name here, sidestepping the `@types/bun` stub entirely.
//
// See https://github.com/oven-sh/bun/issues/30503.
import * as BunModule from "bun-types:internal";

declare global {
  export import Bun = BunModule;
}
