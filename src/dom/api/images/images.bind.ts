import * as b from "../../../codegen/bindgen-lib.ts";
import { HTMLElement } from "../core/html.bind.ts";
import { htmlConstructor, reflect } from "../core/reflect.ts";

export default b.module({
  rustPath: "crate::api::images",
  ceReactions: "crate::api::core::custom",
  isCold: true,
  feature: "Desktop",
  membersInTable: false,
});

const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const each = <T>(names: string, make: (name: string) => T) =>
  Object.fromEntries(names.split(/\s+/).map(name => [name, make(name)]));
const size = b.u32.wrap;

export const HTMLImageElement = b.interface("HTMLImageElement", {
  extends: HTMLElement,
  exposed: ["Window"],
  ...htmlConstructor,
  legacyFactory: {
    Image: { args: { width: size.optional, height: size.optional }, passNewTarget: true, ...runs, throws: true },
  },
  proto: {
    ...reflect(`alt src@ srcset sizes crossOrigin useMap isMap? referrerPolicy decoding loading fetchPriority name lowsrc@ align
      hspace+0 vspace+0 longDesc@ border!`),
    ...each("width height", () => ({ getter: size, setter: true, ceReactions: true, ...runs })),
    ...each("naturalWidth naturalHeight", () => ({ getter: b.u32 })),
    complete: { getter: b.bool },
    currentSrc: { getter: b.USVString, ...heap },
    ...each("x y", () => ({ getter: b.i32, ...runs })),
    decode: { returns: b.any.returning("Promise"), rejects: true, ...runs },
  },
});

export const HTMLSourceElement = b.interface("HTMLSourceElement", {
  extends: HTMLElement,
  exposed: ["Window"],
  ...htmlConstructor,
  proto: reflect("src@ type srcset sizes media width+0 height+0"),
});
