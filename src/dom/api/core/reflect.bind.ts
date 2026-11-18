import * as b from "../../../codegen/bindgen-lib.ts";
import { Node } from "./core.bind.ts";

export default b.module({
  rustPath: "crate::api::core::reflect",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  isCold: true,
});

const heap = { capability: "heap" } as const;
const family = (name: string, key: string, getter: any, setterType: any, rest: object = {}) =>
  b.family(name, {
    on: Node,
    key: `crate::api::core::${key}`,
    getter,
    setter: { type: setterType, capability: "js", ...rest },
    ceReactions: true,
    ...heap,
  });
const string = b.DOMString.impl;

export const ReflectString = family("ReflectString", "Known", string, string);
export const ReflectNullToEmpty = family("ReflectNullToEmpty", "Known", string, b.DOMString.nullToEmpty.impl);
export const ReflectUsvString = family("ReflectUsvString", "Known", string, b.USVString.impl);
export const ReflectNullable = family("ReflectNullable", "Known", string.nullable, string.nullable);
export const ReflectBoolean = family("ReflectBoolean", "Known", b.bool, b.bool.loose);
export const ReflectLong = family("ReflectLong", "reflect::Integer", b.i32, b.i32.wrap, { throws: true });
export const ReflectUnsigned = family("ReflectUnsigned", "reflect::Integer", b.u32, b.u32.wrap, { throws: true });
export const ReflectEnumerated = family("ReflectEnumerated", "reflect::Enumerated", string, string);
export const ReflectNullableEnumerated = family(
  "ReflectNullableEnumerated",
  "reflect::Enumerated",
  string.nullable,
  string.nullable,
);
export const ReflectElement = family(
  "ReflectElement",
  "Known",
  b.ref("DomElement").nullable,
  b.ref("DomElement").nullable,
);
export const ReflectElements = family("ReflectElements", "Known", b.any, b.sequence(b.ref("DomElement")).nullable);
export const ReflectUrl = b.family("ReflectUrl", {
  on: Node,
  key: "crate::api::core::Known",
  getter: string,
  setter: { type: b.USVString.impl },
  ceReactions: true,
  capability: "js",
});
export const ReflectAria = b.family("ReflectAria", {
  on: Node,
  getter: string.nullable,
  setter: { type: string.nullable, capability: "js" },
  ceReactions: true,
  ...heap,
});
const trusted = {
  on: Node,
  key: "crate::api::core::Known",
  getter: string,
  setter: { type: b.any, throws: true },
  ceReactions: true,
  capability: "js",
} as const;
export const ReflectTrustedString = b.family("ReflectTrustedString", trusted);
export const ReflectTrustedUrl = b.family("ReflectTrustedUrl", trusted);
export const ReflectTokens = b.family("ReflectTokens", {
  on: Node,
  key: "crate::api::core::reflect::Tokens",
  getter: b.any,
  putForwards: "value",
  ...heap,
});
