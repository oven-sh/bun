// https://w3c.github.io/trusted-types/dist/spec/
import * as b from "../../../codegen/bindgen-lib.ts";

export default b.module({ rustPath: "crate::api::trusted", feature: "Desktop", isCold: true, membersInTable: false });

const heap = { capability: "heap" } as const;
const js = { capability: "js", throws: true } as const;
const exposed = ["Window", "Worker"] as const;
const string = b.DOMString.impl.as("crate::api::core::DomString");
const atom = b.DOMString.atom.as("crate::api::core::Atom");

export const TrustedString = b.interface("TrustedString", {
  abstract: true,
  rustPath: "crate::api::trusted::TrustedString",
});
export const TrustedMembers = b.mixin("TrustedMembers", {
  on: TrustedString,
  proto: { toString: { returns: string, rustName: "text" }, toJSON: { returns: string, rustName: "text" } },
});
const trusted = (name: string) => b.interface(name, { extends: TrustedString, includes: [TrustedMembers], exposed });
export const TrustedHTML = trusted("TrustedHTML");
export const TrustedScript = trusted("TrustedScript");
export const TrustedScriptURL = trusted("TrustedScriptURL");

const create = (input: any, rustName: string) =>
  ({ args: { input, arguments: b.rest(b.any) }, returns: TrustedString, rustName, ...js }) as const;
export const TrustedTypePolicy = b.interface("TrustedTypePolicy", {
  rustPath: "crate::api::trusted::Policy",
  internalFields: ["createHtml", "createScript", "createScriptUrl"],
  exposed,
  proto: {
    name: { getter: string },
    createHTML: create(b.DOMString, "create_html"),
    createScript: create(b.DOMString, "create_script"),
    createScriptURL: create(b.USVString, "create_script_url"),
  },
});

const callback = b.callable.nullable.optional;
export const TrustedTypePolicyOptions = b.dictionary(
  { createHTML: callback, createScript: callback, createScriptURL: callback },
  { webidl: true },
);

const is = (rustName: string) => ({ args: { value: b.any }, returns: b.bool, rustName, ...heap }) as const;
const name = b.string.utf8.nullable;
export const TrustedTypePolicyFactory = b.interface("TrustedTypePolicyFactory", {
  rustPath: "crate::api::trusted::Factory",
  internalFields: { defaultPolicy: TrustedTypePolicy },
  exposed,
  proto: {
    createPolicy: {
      args: { policyName: string, policyOptions: TrustedTypePolicyOptions.default({}) },
      returns: TrustedTypePolicy,
      ...js,
    },
    isHTML: is("is_html"),
    isScript: is("is_script"),
    isScriptURL: is("is_script_url"),
    emptyHTML: { getter: TrustedString, cache: true, rustName: "empty_html", ...heap },
    emptyScript: { getter: TrustedString, cache: true, ...heap },
    getAttributeType: {
      args: { tagName: atom, attribute: atom, elementNs: atom.nullable.optional, attrNs: atom.nullable.optional },
      returns: name,
    },
    getPropertyType: { args: { tagName: atom, property: atom, elementNs: atom.nullable.optional }, returns: name },
    defaultPolicy: { getter: TrustedTypePolicy.nullable, field: "defaultPolicy" },
  },
});
