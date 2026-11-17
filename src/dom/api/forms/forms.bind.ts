import * as b from "../../../codegen/bindgen-lib.ts";
import { HTMLCollection, NodeList } from "../core/collections.bind.ts";
import { DomElement, Node } from "../core/core.bind.ts";
import { HTMLElement, HTMLObjectElement } from "../core/html.bind.ts";
import { htmlConstructor, reference, reflect, tokenList } from "../core/reflect.ts";

export default b.module({
  rustPath: "crate::api::forms::entry",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const heap = { capability: "heap" } as const;
const runs = { capability: "js" } as const;
const throws = { capability: "js", throws: true } as const;
const reacts = { capability: "js", ceReactions: true } as const;
const atom = b.DOMString.atom.as("crate::api::core::Atom");
const string = b.DOMString.impl.as("crate::api::core::DomString");
const nullToEmpty = b.DOMString.nullToEmpty.impl.as("crate::api::core::DomString");
const known = (name: string) => `crate::api::core::atom!("${name}")`;
const property = (getter: any, type: any = getter, rest: object = {}) =>
  ({ getter, setter: { type, ...runs, ...rest } }) as const;
const attribute = (getter: any, type: any = getter, rest: object = {}) =>
  ({ ...property(getter, type, rest), ceReactions: true }) as const;
const object = { getter: b.any, ...heap } as const;
const element = (name: string, proto: object, rest: object = {}) =>
  b.interface(name, { extends: HTMLElement, ...htmlConstructor, proto, ...rest } as any);

const flags = {
  valueMissing: "VALUE_MISSING",
  typeMismatch: "TYPE_MISMATCH",
  patternMismatch: "PATTERN_MISMATCH",
  tooLong: "TOO_LONG",
  tooShort: "TOO_SHORT",
  rangeUnderflow: "RANGE_UNDERFLOW",
  rangeOverflow: "RANGE_OVERFLOW",
  stepMismatch: "STEP_MISMATCH",
  badInput: "BAD_INPUT",
  customError: "CUSTOM_ERROR",
};
export const ValidityState = b.interface("ValidityState", {
  internalFields: ["element"],
  proto: { valid: { getter: b.bool } },
});
export const ValidityFlag = b.family("ValidityFlag", {
  on: ValidityState,
  key: "crate::api::forms::validity::Validity",
  getter: b.bool,
});
export const ValidityFlags = b.partial("ValidityFlags", {
  on: ValidityState,
  proto: Object.fromEntries(
    Object.entries(flags).map(([name, flag]) => [
      name,
      ValidityFlag.of(`crate::api::forms::validity::Validity::${flag}`),
    ]),
  ),
});

export const HasForm = b.mixin("HasForm", { on: DomElement, proto: { form: { getter: Node.nullable } } });
export const HasLabels = b.mixin("HasLabels", { on: DomElement, proto: { labels: object } });
export const HasAutocomplete = b.mixin("HasAutocomplete", {
  on: DomElement,
  proto: { autocomplete: attribute(string) },
});
export const HasFormAction = b.mixin("HasFormAction", {
  on: DomElement,
  proto: {
    formAction: { getter: string, setter: { type: b.USVString.impl.as("crate::api::core::DomString") }, ...reacts },
  },
});
export const HasValidity = b.mixin("HasValidity", {
  on: DomElement,
  proto: {
    willValidate: { getter: b.bool },
    validity: object,
    validationMessage: { getter: string },
    checkValidity: { returns: b.bool, ...runs },
    reportValidity: { returns: b.bool, ...runs },
    setCustomValidity: { args: { error: string }, ...runs },
  },
});
export const SelectionMode = b.enumeration(["select", "start", "end", "preserve"]);
export const HasSelection = b.mixin("HasSelection", {
  on: DomElement,
  proto: {
    select: runs,
    selectionStart: property(b.u32.nullable, b.u32.wrap.nullable, { throws: true }),
    selectionEnd: property(b.u32.nullable, b.u32.wrap.nullable, { throws: true }),
    selectionDirection: property(string.nullable, atom.nullable, { throws: true }),
    setRangeText: [
      { args: { replacement: string }, rustName: "replace_selected_text", ...throws },
      {
        args: {
          replacement: string,
          start: b.u32.wrap,
          end: b.u32.wrap,
          selectionMode: SelectionMode.default("preserve"),
        },
        rustName: "set_range_text",
        ...throws,
      },
    ],
    setSelectionRange: { args: { start: b.u32.wrap, end: b.u32.wrap, direction: atom.optional }, ...throws },
    createValueRange: {
      args: { start: b.u32.wrap, end: b.u32.wrap },
      returns: b.ref("OpaqueRange"),
      throws: true,
      ...heap,
    },
  },
});
b.include(HTMLObjectElement, HasForm);
b.include(HTMLObjectElement, HasValidity);

export const HTMLInputElement = element(
  "HTMLInputElement",
  {
    ...reflect(`accept alt defaultChecked? dirName disabled? formEnctype formMethod formNoValidate? formTarget max
      maxLength+-1 min minLength+-1 multiple? name pattern placeholder readOnly? required? size>20 src@ step defaultValue align
      useMap webkitdirectory? incremental? popoverTargetAction`),
    popoverTargetElement: reference("popovertarget"),
    width: { getter: b.u32.wrap, setter: true, ...reacts },
    height: { getter: b.u32.wrap, setter: true, ...reacts },
    type: attribute(string),
    value: { ...attribute(string, nullToEmpty, { throws: true }), isCold: false },
    checked: property(b.bool, b.bool.loose),
    indeterminate: property(b.bool, b.bool.loose),
    files: { ...property(b.any, b.ref("FileList").nullable), ...heap },
    webkitEntries: { getter: b.frozenArray(b.u32) },
    list: { getter: DomElement.nullable },
    valueAsNumber: property(b.f64, b.f64.loose, { throws: true }),
    valueAsDate: { ...property(b.any, b.object.nullable), throws: true, ...heap },
    stepUp: { args: { n: b.i32.wrap.default(1) }, ...throws },
    stepDown: { args: { n: b.i32.wrap.default(1) }, ...throws },
    showPicker: throws,
  },
  { includes: [HasForm, HasLabels, HasAutocomplete, HasFormAction, HasValidity, HasSelection] },
);

export const HTMLTextAreaElement = element(
  "HTMLTextAreaElement",
  {
    ...reflect("cols>20 dirName disabled? maxLength+-1 minLength+-1 name placeholder readOnly? required? rows>2 wrap"),
    type: { getter: string },
    value: { ...property(string, nullToEmpty), isCold: false },
    defaultValue: attribute(string),
    textLength: { getter: b.u32 },
  },
  { includes: [HasForm, HasLabels, HasAutocomplete, HasValidity, HasSelection] },
);

export const HTMLButtonElement = element(
  "HTMLButtonElement",
  {
    ...reflect("disabled? formEnctype formMethod formNoValidate? formTarget name value popoverTargetAction"),
    commandForElement: reference("commandfor"),
    popoverTargetElement: reference("popovertarget"),
    command: attribute(string),
    type: attribute(string),
  },
  { includes: [HasForm, HasLabels, HasFormAction, HasValidity] },
);

export const HTMLFieldSetElement = element(
  "HTMLFieldSetElement",
  { ...reflect("disabled? name"), type: { getter: string }, elements: object },
  { includes: [HasForm, HasValidity] },
);

export const HTMLOutputElement = element(
  "HTMLOutputElement",
  {
    ...reflect("name"),
    htmlFor: tokenList("for"),
    type: { getter: string },
    value: attribute(string),
    defaultValue: attribute(string),
  },
  { includes: [HasForm, HasLabels, HasValidity] },
);

export const HTMLLegendElement = element("HTMLLegendElement", { ...reflect("align"), form: { getter: Node.nullable } });
export const HTMLLabelElement = element("HTMLLabelElement", {
  ...reflect("htmlFor"),
  control: { getter: Node.nullable },
  form: { getter: Node.nullable },
});

export const GaugeNumber = b.family("GaugeNumber", {
  on: DomElement,
  key: "crate::api::core::Known",
  getter: b.f64,
  setter: { type: b.double, ...runs },
  ceReactions: true,
});
const numbers = (...names: string[]) => Object.fromEntries(names.map(it => [it, GaugeNumber.of(known(it))]));
export const HTMLMeterElement = element("HTMLMeterElement", numbers("value", "min", "max", "low", "high", "optimum"), {
  includes: [HasLabels],
});
export const HTMLProgressElement = element(
  "HTMLProgressElement",
  { ...numbers("value", "max"), position: { getter: b.f64 } },
  { includes: [HasLabels] },
);

export const HTMLOptionElement = element(
  "HTMLOptionElement",
  {
    ...reflect("disabled? defaultSelected?"),
    form: { getter: Node.nullable },
    label: attribute(string),
    value: attribute(string),
    text: attribute(string),
    selected: property(b.bool, b.bool.loose),
    index: { getter: b.i32 },
  },
  {
    legacyFactory: {
      Option: {
        args: {
          text: string.default(""),
          value: string.optional,
          defaultSelected: b.bool.loose.default(false),
          selected: b.bool.loose.default(false),
        },
        passNewTarget: true,
        ...throws,
      },
    },
  },
);
export const HTMLOptGroupElement = element("HTMLOptGroupElement", reflect("disabled? label"));
export const HTMLSelectedContentElement = element("HTMLSelectedContentElement", {});
export const HTMLDataListElement = element("HTMLDataListElement", { options: object });

export const OptionOrGroup = b.union({ option: HTMLOptionElement, group: HTMLOptGroupElement }, { webidl: true });
export const ElementOrIndex = b.union({ element: HTMLElement, index: b.i32.wrap }, { webidl: true });
const add = {
  args: { element: OptionOrGroup, before: ElementOrIndex.nullable.optional },
  throws: true,
  ...reacts,
} as const;

const options = { getter: DomElement, setter: { type: HTMLOptionElement.nullable }, throws: true, ...reacts } as const;

export const HTMLOptionsCollection = b.interface("HTMLOptionsCollection", {
  extends: HTMLCollection,
  indexed: options,
  proto: {
    length: attribute(b.u32, b.u32.wrap),
    selectedIndex: property(b.i32, b.i32.wrap),
    add,
    remove: { args: { index: b.i32.wrap }, ...reacts },
  },
});

export const HTMLSelectElement = element(
  "HTMLSelectElement",
  {
    ...reflect("disabled? multiple? name required? size+0"),
    type: { getter: string },
    options: object,
    length: attribute(b.u32, b.u32.wrap),
    item: { args: { index: b.u32.wrap }, returns: DomElement.nullable },
    namedItem: { args: { name: string }, returns: DomElement.nullable },
    add,
    remove: [
      { rustName: "remove_itself", ...reacts },
      { args: { index: b.i32.wrap }, rustName: "remove_option", ...reacts },
    ],
    selectedOptions: object,
    selectedIndex: property(b.i32, b.i32.wrap),
    value: property(string),
    showPicker: throws,
  },
  {
    includes: [HasForm, HasLabels, HasAutocomplete, HasValidity],
    indexed: options,
  },
);

export const RadioNodeList = b.interface("RadioNodeList", { extends: NodeList, proto: { value: property(string) } });
export const HTMLFormControlsCollection = b.interface("HTMLFormControlsCollection", {
  extends: HTMLCollection,
  named: { getter: b.any, unenumerable: true, ...heap },
  proto: { namedItem: { args: { name: b.DOMString.atom }, returns: b.any, ...heap } },
});

export const HTMLFormElement = element(
  "HTMLFormElement",
  {
    ...reflect("acceptCharset autocomplete enctype encoding method name noValidate? target rel"),
    relList: tokenList("rel", "noreferrer noopener opener"),
    action: { getter: string, setter: { type: b.USVString.impl.as("crate::api::core::DomString") }, ...reacts },
    elements: object,
    length: { getter: b.u32 },
    submit: runs,
    requestSubmit: { args: { submitter: HTMLElement.nullable.optional }, ...throws },
    reset: reacts,
    checkValidity: { returns: b.bool, ...runs },
    reportValidity: { returns: b.bool, ...runs },
  },
  { indexed: { getter: DomElement }, named: { getter: b.any, overrideBuiltIns: true, unenumerable: true, ...heap } },
);

export const ValidityStateFlags = b.dictionary(
  Object.fromEntries(Object.keys(flags).map(it => [it, b.bool.loose.default(false)])),
  { webidl: true },
);
const checked = (getter: any) => ({ getter, throws: true, ...heap }) as const;

export const ElementInternals = b.interface("ElementInternals", {
  rustPath: "crate::api::forms::internals::ElementInternals",
  internalFields: ["target"],
  proto: {
    shadowRoot: { getter: b.ref("ShadowRoot").nullable },
    states: { getter: b.any, ...runs },
    setFormValue: { args: { value: b.any, state: b.any.omittable }, length: 1, ...throws },
    setValidity: {
      args: { flags: ValidityStateFlags.default({}), message: string.optional, anchor: HTMLElement.optional },
      ...throws,
    },
    form: checked(Node.nullable),
    labels: checked(b.any),
    willValidate: checked(b.bool),
    validity: checked(b.any),
    validationMessage: checked(string),
    checkValidity: { returns: b.bool, ...throws },
    reportValidity: { returns: b.bool, ...throws },
  },
});

const on = ElementInternals;
const key = "crate::api::core::Known";
export const DefaultSemantics = b.family("DefaultSemantics", { on, key, getter: string.nullable, setter: true });
export const DefaultReference = b.family("DefaultReference", {
  on,
  key,
  getter: DomElement.nullable,
  setter: { type: DomElement.nullable, ...heap },
});
export const DefaultReferences = b.family("DefaultReferences", {
  on,
  key,
  getter: b.any,
  setter: { type: b.sequence(DomElement).nullable },
  ...heap,
});
const aria = (names: string, suffix: string, family: { of(key: string): any }) =>
  Object.fromEntries(
    names.split(/\s+/).map(it => [`aria${it}${suffix}`, family.of(known("aria-" + it.toLowerCase()))]),
  );
export const InternalsAria = b.partial("InternalsAria", {
  on,
  proto: {
    role: DefaultSemantics.of(known("role")),
    ...aria(
      `Atomic AutoComplete BrailleLabel BrailleRoleDescription Busy Checked ColCount ColIndex ColIndexText ColSpan Current Description
      Disabled Expanded HasPopup Hidden Invalid KeyShortcuts Label Level Live Modal MultiLine MultiSelectable Orientation Placeholder
      PosInSet Pressed ReadOnly Relevant Required RoleDescription RowCount RowIndex RowIndexText RowSpan Selected SetSize Sort ValueMax
      ValueMin ValueNow ValueText`,
      "",
      DefaultSemantics,
    ),
    ...aria("ActiveDescendant", "Element", DefaultReference),
    ...aria("Controls DescribedBy Details ErrorMessage FlowTo LabelledBy Owns", "Elements", DefaultReferences),
  },
});
