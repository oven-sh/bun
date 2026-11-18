import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget, Doc, DomElement, Node, ProcessingInstruction, ShadowRoot } from "../core/core.bind.ts";
import { HTMLElement, MathMLElement } from "../core/html.bind.ts";
import { OnEvent } from "../events/events.bind.ts";
import { SVGElement } from "../svg/svg.bind.ts";

export default b.module({
  rustPath: "crate::api::cssom",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const heap = { capability: "heap" } as const;
const allocates = { capability: "heap", throws: true } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const ce = { ...js, ceReactions: true } as const;
const text = b.DOMString.utf8;
const index = b.u32.wrap;
const words = (all: string) => all.trim().split(/\s+/);
const camelCase = (name: string) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const members = <T>(names: string, make: (name: string) => T) =>
  Object.fromEntries(words(names).map(name => [camelCase(name), make(name)]));

export const CSSStyleDeclaration = b.interface("CSSStyleDeclaration", {
  isCold: false,
  exposed: ["Window"],
  rustPath: "crate::api::cssom::CSSStyleDeclaration",
  internalFields: { element: b.ref("DomElement"), parentRule: b.ref("CSSRule") },
  indexed: { getter: text, length: "indexed_length", ...runs },
  proto: {
    cssText: { getter: text, setter: { type: b.DOMString.nullToEmpty.utf8 }, ...ce },
    length: { getter: b.u32, ...runs },
    item: { args: { index }, returns: text, ...runs },
    getPropertyValue: {
      args: { property: b.DOMString },
      returns: b.DOMString,
      rustName: "js_get_property_value",
      ...js,
    },
    getPropertyPriority: { args: { property: text }, returns: text },
    setProperty: {
      args: {
        property: b.DOMString,
        value: b.DOMString.nullToEmpty.utf8,
        priority: b.DOMString.nullToEmpty.utf8.default(""),
      },
      rustName: "js_set_property",
      ...ce,
    },
    removeProperty: { args: { property: b.DOMString }, returns: b.DOMString, ...ce },
    parentRule: { getter: b.ref("CSSRule").nullable, field: "parentRule" },
  },
});

const withAttributes = {
  exposed: ["Window"],
  extends: CSSStyleDeclaration,
  attributesByName: { getter: b.DOMString, setter: { type: b.DOMString.nullToEmpty.utf8 }, ...ce },
} as const;
export const CSSStyleProperties = b.interface("CSSStyleProperties", { ...withAttributes, isCold: false });
export const CSSPageDescriptors = b.interface("CSSPageDescriptors", withAttributes);
export const CSSPositionTryDescriptors = b.interface("CSSPositionTryDescriptors", withAttributes);
export const CSSFontFaceDescriptors = b.interface("CSSFontFaceDescriptors", withAttributes);
export const CSSFunctionDescriptors = b.interface("CSSFunctionDescriptors", withAttributes);

export const MediaList = b.interface("MediaList", {
  exposed: ["Window"],
  internalFields: { sheet: b.ref("CSSStyleSheet"), rule: b.ref("CSSRule") },
  indexed: { getter: text },
  proto: {
    mediaText: { getter: text, setter: { type: b.DOMString.nullToEmpty.utf8 }, stringifier: true, ...runs },
    length: { getter: b.u32 },
    item: { args: { index }, returns: text.nullable },
    appendMedium: { args: { medium: text }, ...runs },
    deleteMedium: { args: { medium: text }, ...js },
  },
});

export const CSSRuleList = b.interface("CSSRuleList", {
  exposed: ["Window"],
  internalFields: { sheet: b.ref("CSSStyleSheet"), rule: b.ref("CSSRule") },
  indexed: { getter: b.ref("CSSRule"), ...heap },
  proto: {
    length: { getter: b.u32 },
    item: { args: { index }, returns: b.ref("CSSRule").nullable, ...heap },
  },
});

export const CSSRule = b.interface("CSSRule", {
  exposed: ["Window"],
  rustPath: "crate::api::cssom::CSSRule",
  internalFields: {
    parentRule: b.ref("CSSRule"),
    // Of one that is in no other rule.
    sheet: b.ref("CSSStyleSheet"),
    children: b.any,
    cssRules: CSSRuleList,
    style: CSSStyleDeclaration,
    other: b.any,
  },
  constants: {
    STYLE_RULE: 1,
    CHARSET_RULE: 2,
    IMPORT_RULE: 3,
    MEDIA_RULE: 4,
    FONT_FACE_RULE: 5,
    PAGE_RULE: 6,
    KEYFRAMES_RULE: 7,
    KEYFRAME_RULE: 8,
    MARGIN_RULE: 9,
    NAMESPACE_RULE: 10,
    COUNTER_STYLE_RULE: 11,
    SUPPORTS_RULE: 12,
    FONT_FEATURE_VALUES_RULE: 14,
  },
  proto: {
    cssText: { getter: text, setter: true },
    parentRule: { getter: b.ref("CSSRule").nullable, field: "parentRule" },
    parentStyleSheet: { getter: b.ref("CSSStyleSheet").nullable },
    type: { getter: b.u16 },
  },
});

const style = { getter: CSSStyleDeclaration, cache: "style", putForwards: "cssText", ...heap } as const;
const cssRules = { getter: CSSRuleList, cache: "cssRules", ...heap } as const;
const media = { getter: b.any, cache: "other", putForwards: "mediaText", ...heap } as const;
const frozen = (type: any) => ({ getter: b.frozenArray(type), cache: "other" });
const readOnly = { getter: text } as const;
const writable = { getter: text, setter: true, ...runs } as const;

export const HasStyle = b.mixin("HasStyle", { on: CSSRule, proto: { style } });
export const HasName = b.mixin("HasName", { on: CSSRule, proto: { name: readOnly } });
export const HasSelector = b.mixin("HasSelector", { on: CSSRule, proto: { selectorText: writable } });
export const RuleDescriptor = b.family("RuleDescriptor", { on: CSSRule, key: "&str", ...writable });
const ruleDescriptors = (names: string, options = {}) =>
  members(names, name => RuleDescriptor.of(`"${name}"`, options));

export const CSSGroupingRule = b.interface("CSSGroupingRule", {
  exposed: ["Window"],
  extends: CSSRule,
  proto: {
    cssRules,
    insertRule: { args: { rule: text, index: index.default(0) }, returns: b.u32, ...js },
    deleteRule: { args: { index }, ...js },
  },
});

export const CSSStyleRule = b.interface("CSSStyleRule", {
  exposed: ["Window"],
  extends: CSSGroupingRule,
  includes: [HasSelector, HasStyle],
  proto: { styleMap: { getter: b.any, cache: "other", ...heap } },
});

export const CSSConditionRule = b.interface("CSSConditionRule", {
  exposed: ["Window"],
  extends: CSSGroupingRule,
  proto: { conditionText: readOnly },
});

export const CSSMediaRule = b.interface("CSSMediaRule", {
  exposed: ["Window"],
  extends: CSSConditionRule,
  proto: { media, matches: { getter: b.bool } },
});

export const CSSSupportsRule = b.interface("CSSSupportsRule", {
  exposed: ["Window"],
  extends: CSSConditionRule,
  proto: { matches: { getter: b.bool } },
});

export const CSSContainerCondition = b.dictionary({ name: text, query: text }, { webidl: true });

export const CSSContainerRule = b.interface("CSSContainerRule", {
  exposed: ["Window"],
  extends: CSSConditionRule,
  proto: { containerName: readOnly, containerQuery: readOnly, conditions: frozen(CSSContainerCondition) },
});

export const CSSLayerBlockRule = b.interface("CSSLayerBlockRule", {
  exposed: ["Window"],
  extends: CSSGroupingRule,
  includes: [HasName],
});
export const CSSLayerStatementRule = b.interface("CSSLayerStatementRule", {
  exposed: ["Window"],
  extends: CSSRule,
  proto: { nameList: frozen(text) },
});

export const CSSScopeRule = b.interface("CSSScopeRule", {
  exposed: ["Window"],
  extends: CSSGroupingRule,
  proto: { start: { getter: text.nullable }, end: { getter: text.nullable } },
});

export const CSSStartingStyleRule = b.interface("CSSStartingStyleRule", {
  exposed: ["Window"],
  extends: CSSGroupingRule,
});

export const CSSPageRule = b.interface("CSSPageRule", {
  exposed: ["Window"],
  extends: CSSGroupingRule,
  includes: [HasSelector],
  proto: { style },
});

export const CSSMarginRule = b.interface("CSSMarginRule", {
  exposed: ["Window"],
  extends: CSSRule,
  includes: [HasName, HasStyle],
});
export const CSSNestedDeclarations = b.interface("CSSNestedDeclarations", {
  exposed: ["Window"],
  extends: CSSRule,
  includes: [HasStyle],
});

export const CSSFontFaceRule = b.interface("CSSFontFaceRule", {
  exposed: ["Window"],
  extends: CSSRule,
  proto: { style },
});

export const CSSFontPaletteValuesRule = b.interface("CSSFontPaletteValuesRule", {
  exposed: ["Window"],
  extends: CSSRule,
  includes: [HasName],
  proto: ruleDescriptors("font-family base-palette override-colors", { setter: undefined }),
});

export const CSSPositionTryRule = b.interface("CSSPositionTryRule", {
  exposed: ["Window"],
  extends: CSSRule,
  includes: [HasName],
  proto: { style },
});

export const CSSCounterStyleRule = b.interface("CSSCounterStyleRule", {
  exposed: ["Window"],
  extends: CSSRule,
  proto: {
    name: writable,
    ...ruleDescriptors("system symbols additive-symbols negative prefix suffix range pad speak-as fallback"),
  },
});

export const FunctionParameter = b.dictionary(
  { defaultValue: text.optional, name: text, type: { type: text, rustName: "syntax" } },
  { webidl: true },
);

export const CSSFunctionRule = b.interface("CSSFunctionRule", {
  exposed: ["Window"],
  extends: CSSGroupingRule,
  includes: [HasName],
  proto: { getParameters: { returns: b.sequence(FunctionParameter) }, returnType: readOnly },
});

export const CSSFunctionDeclarations = b.interface("CSSFunctionDeclarations", {
  exposed: ["Window"],
  extends: CSSRule,
  proto: { style },
});

export const CSSViewTransitionRule = b.interface("CSSViewTransitionRule", {
  exposed: ["Window"],
  extends: CSSRule,
  proto: { ...ruleDescriptors("navigation", { setter: undefined }), types: frozen(text) },
});

export const CSSKeyframeRule = b.interface("CSSKeyframeRule", {
  exposed: ["Window"],
  extends: CSSRule,
  includes: [HasStyle],
  proto: { keyText: { getter: text, setter: true, ...js } },
});

export const CSSKeyframesRule = b.interface("CSSKeyframesRule", {
  exposed: ["Window"],
  extends: CSSRule,
  indexed: { getter: b.ref("CSSRule"), ...heap },
  proto: {
    name: writable,
    cssRules,
    length: { getter: b.u32 },
    appendRule: { args: { rule: text }, ...runs },
    deleteRule: { args: { select: text }, ...runs },
    findRule: { args: { select: text }, returns: CSSRule.nullable, ...heap },
  },
});

export const CSSImportRule = b.interface("CSSImportRule", {
  exposed: ["Window"],
  extends: CSSRule,
  proto: {
    href: readOnly,
    media,
    styleSheet: { getter: b.ref("CSSStyleSheet").nullable, ...heap },
    layerName: { getter: text.nullable },
    supportsText: { getter: text.nullable },
  },
});

export const CSSNamespaceRule = b.interface("CSSNamespaceRule", {
  exposed: ["Window"],
  extends: CSSRule,
  proto: { namespaceURI: { ...readOnly, rustName: "namespace_uri" }, prefix: readOnly },
});

export const CSSPropertyRule = b.interface("CSSPropertyRule", {
  exposed: ["Window"],
  extends: CSSRule,
  includes: [HasName],
  proto: { syntax: readOnly, inherits: { getter: b.bool }, initialValue: { getter: text.nullable } },
});

export const FeatureValues = b.union({ many: b.sequenceVec(index), one: index }, { webidl: true });

export const CSSFontFeatureValuesMap = b.interface("CSSFontFeatureValuesMap", {
  exposed: ["Window"],
  rustPath: "crate::api::cssom::CSSFontFeatureValuesMap",
  internalFields: { rule: CSSRule },
  maplike: { key: b.DOMString, value: b.any },
  proto: {
    set: { args: { featureValueName: b.DOMString, values: FeatureValues }, ...js },
    delete: { args: { key: b.DOMString }, returns: b.bool, ...js },
    clear: js,
  },
});

export const FeatureMap = b.family("FeatureMap", {
  on: CSSRule,
  key: "crate::prelude::FeatureKind",
  getter: CSSFontFeatureValuesMap,
  ...allocates,
});

export const CSSFontFeatureValuesRule = b.interface("CSSFontFeatureValuesRule", {
  exposed: ["Window"],
  extends: CSSRule,
  proto: {
    fontFamily: writable,
    ...members("annotation ornaments stylistic swash character-variant styleset", name =>
      FeatureMap.of("crate::prelude::FeatureKind::" + camelCase("-" + name)),
    ),
  },
});

export const StyleSheet = b.interface("StyleSheet", {
  exposed: ["Window"],
  rustPath: "crate::api::cssom::StyleSheet",
  internalFields: {
    ownerNode: b.ref("Node"),
    parentStyleSheet: b.ref("CSSStyleSheet"),
    // The document or the shadow root that lists it.
    scope: b.ref("Node"),
    constructorDocument: b.ref("Doc"),
    adoptedIn: b.any,
    imports: b.any,
    children: b.any,
    cssRules: CSSRuleList,
    media: b.any,
  },
  proto: {
    type: readOnly,
    href: { getter: text.nullable },
    ownerNode: { getter: b.ref("Node").nullable, field: "ownerNode" },
    parentStyleSheet: { getter: b.ref("CSSStyleSheet").nullable, field: "parentStyleSheet" },
    title: { getter: b.DOMString.nullable, ...heap },
    media: { ...media, cache: "media" },
    disabled: { getter: b.bool.loose, setter: true, ...runs },
  },
});

export const CSSStyleSheetInit = b.dictionary(
  {
    baseURL: { type: text.nullable.optional, rustName: "base_url" },
    disabled: b.bool.loose.default(false),
    media: text.default(""),
  },
  { webidl: true },
);

export const CSSStyleSheet = b.interface("CSSStyleSheet", {
  exposed: ["Window"],
  extends: StyleSheet,
  construct: { args: { options: CSSStyleSheetInit.default({}) }, passStructure: true, ...js },
  proto: {
    ownerRule: { getter: CSSRule.nullable, ...heap },
    cssRules: { getter: CSSRuleList, ...allocates },
    rules: { getter: CSSRuleList, rustName: "css_rules", ...allocates },
    insertRule: { args: { rule: text, index: index.default(0) }, returns: b.u32, ...js },
    deleteRule: { args: { index }, ...js },
    addRule: {
      args: { selector: text.default("undefined"), style: text.default("undefined"), index: index.optional },
      returns: b.i32,
      ...js,
    },
    removeRule: { args: { index: index.default(0) }, rustName: "delete_rule", ...js },
    replace: { args: { text: b.USVString.utf8 }, returns: b.any, rejects: true, ...js },
    replaceSync: { args: { text: b.USVString.utf8 }, ...js },
  },
});

export const StyleSheetList = b.interface("StyleSheetList", {
  exposed: ["Window"],
  internalFields: { scope: b.ref("Node") },
  indexed: { getter: CSSStyleSheet, ...heap },
  proto: {
    length: { getter: b.u32 },
    item: { args: { index }, returns: CSSStyleSheet.nullable, ...heap },
  },
});

export const CSSPseudoElement = b.interface("CSSPseudoElement", {
  exposed: ["Window"],
  rustPath: "crate::api::cssom::CSSPseudoElement",
  internalFields: { element: b.ref("DomElement"), parent: b.any, marker: b.ref("CSSPseudoElement") },
  proto: {
    type: readOnly,
    element: { getter: b.ref("DomElement"), field: "element" },
    parent: { getter: b.any, field: "parent" },
    selectorText: readOnly,
    pseudo: { args: { type: text }, returns: b.ref("CSSPseudoElement").nullable, ...heap },
  },
});

export const ElementPseudo = b.partial("ElementPseudo", {
  on: DomElement,
  proto: { pseudo: { args: { type: text }, returns: CSSPseudoElement.nullable, ...heap } },
});

export const InstructionStyle = b.partial("InstructionStyle", {
  on: ProcessingInstruction,
  proto: { sheet: { getter: CSSStyleSheet.nullable, ...heap } },
});

export const HasStyleSheets = b.mixin("HasStyleSheets", {
  on: Node,
  proto: {
    styleSheets: { getter: StyleSheetList, ...heap },
    adoptedStyleSheets: { getter: b.any, setter: { type: b.sequence(CSSStyleSheet), ...js }, ...heap },
  },
});
b.include(Doc, HasStyleSheets);
b.include(ShadowRoot, HasStyleSheets);

export const PropertyDefinition = b.dictionary(
  { inherits: b.bool.loose, initialValue: text.optional, name: text, syntax: text.default("*") },
  { webidl: true },
);

const element = b.ref("DomElement");

const units =
  words(`number percent cap ch em ex ic lh rcap rch rem rex ric rlh vw vh vi vb vmin vmax svw svh svi svb svmin
  svmax lvw lvh lvi lvb lvmin lvmax dvw dvh dvi dvb dvmin dvmax cqw cqh cqi cqb cqmin cqmax cm mm Q in pt pc px deg grad rad
  turn s ms Hz kHz dpi dpcm dppx x fr`);

export const CSSNamespace = b.interface("CSSNamespace", {
  exposed: ["Window"],
  name: "CSS",
  namespace: true,
  static: {
    escape: { args: { ident: b.DOMString }, returns: b.DOMString, ...allocates },
    supports: [
      { args: { conditionText: text }, returns: b.bool, rustName: "supports_condition" },
      { args: { property: text, value: text }, returns: b.bool, rustName: "supports_declaration" },
    ],
    registerProperty: { args: { definition: PropertyDefinition }, ...js },
    highlights: { getter: b.ref("HighlightRegistry"), ...js },
    ...Object.fromEntries(
      units.map(unit => [
        unit,
        {
          args: { value: b.double },
          returns: b.ref("CSSNumericValue"),
          rustName: "unit_" + unit.toLowerCase(),
          ...heap,
        },
      ]),
    ),
  },
});

export const ElementCSSInlineStyle = b.mixin("ElementCSSInlineStyle", {
  on: DomElement,
  proto: { style: { getter: CSSStyleProperties, putForwards: "cssText", shortcut: "styleEdge", ...heap } },
});
for (const it of [HTMLElement, MathMLElement, SVGElement]) b.include(it, ElementCSSInlineStyle);

export const MediaQueryList = b.interface("MediaQueryList", {
  exposed: ["Window"],
  extends: DesktopEventTarget,
  rustPath: "crate::api::cssom::MediaQueryList",
  internalFields: { document: Doc },
  proto: {
    media: { getter: text },
    matches: { getter: b.bool, ...runs },
    addListener: { args: { callback: b.object.nullable }, ...allocates },
    removeListener: { args: { callback: b.object.nullable }, ...heap },
    onchange: OnEvent.of('crate::api::core::atom!("change")'),
  },
});
/** For a window that is not the global object. */
export const getComputedStyle = b.fn({
  args: { elt: element, pseudoElt: text.nullable.optional },
  returns: CSSStyleProperties,
  requiredArguments: 1,
  ...heap,
});
