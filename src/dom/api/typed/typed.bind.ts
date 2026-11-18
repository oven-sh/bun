import * as b from "../../../codegen/bindgen-lib.ts";
import { DomElement } from "../core/core.bind.ts";
import { HTMLElement, MathMLElement } from "../core/html.bind.ts";
import { SVGElement } from "../svg/svg.bind.ts";

export default b.module({
  rustPath: "crate::api::typed",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  isCold: true,
  membersInTable: false,
});

const heap = { capability: "heap" } as const;
const allocates = { capability: "heap", throws: true } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const text = b.USVString.utf8;
const webidl = { webidl: true } as const;
const construct = (args: Record<string, any>, rustName?: string) =>
  ({ args, passStructure: true, ...allocates, ...(rustName && { rustName }) }) as const;
const slots = ["first", "second", "third", "fourth"];
const slot = (index: number) => ({ getter: b.any, field: slots[index] });

export const CSSStyleValue = b.interface("CSSStyleValue", {
  exposed: ["Window"],
  rustPath: "crate::api::typed::CSSStyleValue",
  internalFields: slots.slice(0, 3),
  static: {
    parse: {
      args: { property: text, cssText: text },
      returns: b.ref("CSSStyleValue"),
      exposed: ["Window"],
      ...allocates,
    },
    parseAll: {
      args: { property: text, cssText: text },
      returns: b.sequence(b.any),
      exposed: ["Window"],
      ...allocates,
    },
  },
  proto: { toString: { returns: text, rustName: "stringify", ...heap } },
});

export const CSSImageValue = b.interface("CSSImageValue", { exposed: ["Window"], extends: CSSStyleValue });

export const CSSKeywordValue = b.interface("CSSKeywordValue", {
  exposed: ["Window"],
  extends: CSSStyleValue,
  construct: { args: { value: text }, ...allocates },
  proto: { value: { getter: text, setter: true, ...allocates } },
});

export const CSSVariableReferenceValue = b.interface("CSSVariableReferenceValue", {
  exposed: ["Window"],
  rustPath: "crate::api::typed::CSSVariableReferenceValue",
  internalFields: { fallback: b.ref("CSSUnparsedValue") },
  construct: construct({ variable: text, fallback: b.ref("CSSUnparsedValue").nullable.optional }),
  proto: {
    variable: { getter: text, setter: true, ...allocates },
    fallback: { getter: b.ref("CSSUnparsedValue").nullable, field: "fallback" },
  },
});

export const CSSUnparsedSegment = b.union({ variable: CSSVariableReferenceValue, text: b.USVString }, webidl);

export const HasItems = b.mixin("HasItems", { on: CSSStyleValue, proto: { length: { getter: b.u32 } } });

export const CSSUnparsedValue = b.interface("CSSUnparsedValue", {
  exposed: ["Window"],
  extends: CSSStyleValue,
  includes: [HasItems],
  construct: construct({ members: b.sequence(CSSUnparsedSegment) }),
  indexed: { getter: b.any, setter: { type: CSSUnparsedSegment }, ...allocates },
  iterable: "values",
});

const numeric = b.ref("CSSNumericValue");
export const CSSNumberish = b.union({ value: numeric, number: b.double }, webidl);
const baseTypes = ["length", "angle", "time", "frequency", "resolution", "flex", "percent"] as const;
export const CSSNumericBaseType = b.enumeration(baseTypes);
export const CSSNumericType = b.dictionary(
  { ...Object.fromEntries(baseTypes.map(it => [it, b.i32.optional])), percentHint: CSSNumericBaseType.optional },
  webidl,
);
const arithmetic = { args: { values: b.rest(CSSNumberish) }, returns: numeric, ...allocates } as const;

export const CSSNumericValue = b.interface("CSSNumericValue", {
  exposed: ["Window"],
  extends: CSSStyleValue,
  static: { parse: { args: { cssText: text }, returns: numeric, exposed: ["Window"], ...allocates } },
  proto: {
    add: arithmetic,
    sub: arithmetic,
    mul: arithmetic,
    div: arithmetic,
    min: arithmetic,
    max: arithmetic,
    equals: { args: { value: b.rest(CSSNumberish) }, returns: b.bool, ...heap },
    to: { args: { unit: text }, returns: numeric, ...allocates },
    toSum: { args: { units: b.rest(b.USVString) }, returns: numeric, ...allocates },
    type: { returns: CSSNumericType },
  },
});

export const CSSUnitValue = b.interface("CSSUnitValue", {
  exposed: ["Window"],
  extends: CSSNumericValue,
  construct: { args: { value: b.double, unit: text }, ...allocates },
  proto: { value: { getter: b.f64, setter: { type: b.double } }, unit: { getter: text } },
});

export const CSSNumericArray = b.interface("CSSNumericArray", {
  exposed: ["Window"],
  internalFields: ["items"],
  indexed: { getter: b.any },
  iterable: "values",
  proto: { length: { getter: b.u32 } },
});

export const CSSMathOperator = b.enumeration(["sum", "product", "negate", "invert", "min", "max", "clamp"]);

export const CSSMathValue = b.interface("CSSMathValue", {
  exposed: ["Window"],
  extends: CSSNumericValue,
  proto: { operator: { getter: CSSMathOperator } },
});

const ofMany = {
  exposed: ["Window"],
  extends: CSSMathValue,
  construct: construct({ args: b.rest(CSSNumberish) }),
  proto: { values: slot(0) },
} as const;
const ofOne = {
  exposed: ["Window"],
  extends: CSSMathValue,
  construct: construct({ arg: CSSNumberish }),
  proto: { value: slot(0) },
} as const;
export const CSSMathSum = b.interface("CSSMathSum", ofMany);
export const CSSMathProduct = b.interface("CSSMathProduct", ofMany);
export const CSSMathMin = b.interface("CSSMathMin", ofMany);
export const CSSMathMax = b.interface("CSSMathMax", ofMany);
export const CSSMathNegate = b.interface("CSSMathNegate", ofOne);
export const CSSMathInvert = b.interface("CSSMathInvert", ofOne);
export const CSSMathClamp = b.interface("CSSMathClamp", {
  exposed: ["Window"],
  extends: CSSMathValue,
  construct: construct({ lower: CSSNumberish, value: CSSNumberish, upper: CSSNumberish }),
  proto: { lower: slot(0), value: slot(1), upper: slot(2) },
});

export const Coordinate = b.family("Coordinate", {
  on: CSSStyleValue,
  key: "usize",
  getter: b.any,
  setter: { type: numeric },
  ...allocates,
});

export const CSSPositionValue = b.interface("CSSPositionValue", {
  exposed: ["Window"],
  extends: CSSStyleValue,
  construct: construct({ x: numeric, y: numeric }),
  proto: { x: Coordinate.of("0"), y: Coordinate.of("1") },
});

export const CSSTransformComponent = b.interface("CSSTransformComponent", {
  exposed: ["Window"],
  rustPath: "crate::api::typed::CSSTransformComponent",
  internalFields: slots,
  proto: {
    is2D: { getter: b.bool.loose, setter: true, rustName: "is_2d" },
    toMatrix: { returns: b.ref("DOMMatrix"), ...allocates },
    toString: { returns: text, rustName: "stringify", ...heap },
  },
});

const argument = { on: CSSTransformComponent, key: "usize", getter: b.any, ...allocates } as const;
export const Dimension = b.family("Dimension", { ...argument, setter: { type: numeric } });
export const Factor = b.family("Factor", { ...argument, setter: { type: CSSNumberish } });
const axes = (family: typeof Factor) => ({ x: family.of("0"), y: family.of("1"), z: family.of("2") });

export const CSSTranslate = b.interface("CSSTranslate", {
  exposed: ["Window"],
  extends: CSSTransformComponent,
  construct: construct({ x: numeric, y: numeric, z: numeric.optional }),
  proto: axes(Dimension),
});

export const CSSRotate = b.interface("CSSRotate", {
  exposed: ["Window"],
  extends: CSSTransformComponent,
  construct: [
    construct({ angle: numeric }),
    construct({ x: CSSNumberish, y: CSSNumberish, z: CSSNumberish, angle: numeric }, "around"),
  ],
  proto: { ...axes(Factor), angle: Dimension.of("3") },
});

export const CSSScale = b.interface("CSSScale", {
  exposed: ["Window"],
  extends: CSSTransformComponent,
  construct: construct({ x: CSSNumberish, y: CSSNumberish, z: CSSNumberish.optional }),
  proto: axes(Factor),
});

export const CSSSkew = b.interface("CSSSkew", {
  exposed: ["Window"],
  extends: CSSTransformComponent,
  construct: construct({ ax: numeric, ay: numeric }),
  proto: { ax: Dimension.of("0"), ay: Dimension.of("1") },
});

export const CSSSkewX = b.interface("CSSSkewX", {
  exposed: ["Window"],
  extends: CSSTransformComponent,
  construct: construct({ ax: numeric }),
  proto: { ax: Dimension.of("0") },
});

export const CSSSkewY = b.interface("CSSSkewY", {
  exposed: ["Window"],
  extends: CSSTransformComponent,
  construct: construct({ ay: numeric }),
  proto: { ay: Dimension.of("0") },
});

export const CSSPerspectiveValue = b.union({ length: numeric, keyword: CSSKeywordValue, text }, webidl);

export const CSSPerspective = b.interface("CSSPerspective", {
  exposed: ["Window"],
  extends: CSSTransformComponent,
  construct: construct({ length: CSSPerspectiveValue }),
  proto: { length: { getter: b.any, setter: { type: CSSPerspectiveValue }, ...allocates } },
});

export const CSSMatrixComponentOptions = b.dictionary(
  { is2D: { type: b.bool.loose.optional, rustName: "is_2d" } },
  webidl,
);

export const CSSMatrixComponent = b.interface("CSSMatrixComponent", {
  exposed: ["Window"],
  extends: CSSTransformComponent,
  construct: {
    args: { matrix: b.ref("DOMMatrixReadOnly"), options: CSSMatrixComponentOptions.default({}) },
    passStructure: true,
    ...heap,
  },
  proto: { matrix: { getter: b.any, setter: { type: b.ref("DOMMatrix") } } },
});

export const CSSTransformValue = b.interface("CSSTransformValue", {
  exposed: ["Window"],
  extends: CSSStyleValue,
  includes: [HasItems],
  construct: construct({ transforms: b.sequence(CSSTransformComponent) }),
  indexed: { getter: b.any, setter: { type: CSSTransformComponent }, ...allocates },
  iterable: "values",
  proto: {
    is2D: { getter: b.bool, rustName: "is_2d", ...heap },
    toMatrix: { returns: b.ref("DOMMatrix"), ...allocates },
  },
});

export const StylePropertyMapIterator = b.interface("StylePropertyMapIterator", {
  name: "StylePropertyMapReadOnly Iterator",
  rustPath: "crate::api::typed::StylePropertyMapIterator",
  noInterfaceObject: true,
  prototypeBase: "Iterator",
  internalFields: { map: b.ref("StylePropertyMapReadOnly") },
  proto: { next: { returns: b.object, ...js } },
});

export const StylePropertyMapReadOnly = b.interface("StylePropertyMapReadOnly", {
  exposed: ["Window"],
  rustPath: "crate::api::typed::StylePropertyMapReadOnly",
  internalFields: { style: b.ref("CSSStyleDeclaration") },
  sameFunction: { "@@iterator": "entries" },
  proto: {
    entries: { returns: StylePropertyMapIterator, ...heap },
    keys: { returns: StylePropertyMapIterator, ...heap },
    values: { returns: StylePropertyMapIterator, ...heap },
    forEach: { args: { callback: b.callable, thisArg: b.any.omittable }, ...js },
    get: { args: { property: text }, returns: b.any, ...js },
    getAll: { args: { property: text }, returns: b.any, ...js },
    has: { args: { property: text }, returns: b.bool, ...js },
    size: { getter: b.u32, ...runs },
  },
});

export const ValueOrText = b.union({ value: CSSStyleValue, text: b.USVString }, webidl);
const ce = { ...js, ceReactions: true } as const;

export const StylePropertyMap = b.interface("StylePropertyMap", {
  exposed: ["Window"],
  extends: StylePropertyMapReadOnly,
  proto: {
    set: { args: { property: text, values: b.rest(ValueOrText) }, ...ce },
    append: { args: { property: text, values: b.rest(ValueOrText) }, ...ce },
    delete: { args: { property: text }, ...ce },
    clear: { ...runs, ceReactions: true },
  },
});

export const ElementStyleMap = b.partial("ElementStyleMap", {
  on: DomElement,
  proto: { computedStyleMap: { returns: b.any, ...heap } },
});

export const ElementInlineStyleMap = b.mixin("ElementInlineStyleMap", {
  on: DomElement,
  proto: { attributeStyleMap: { getter: StylePropertyMap, ...heap } },
});
for (const it of [HTMLElement, MathMLElement, SVGElement]) b.include(it, ElementInlineStyleMap);
