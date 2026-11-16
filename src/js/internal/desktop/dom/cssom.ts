const core = require("internal/desktop/dom/core");
const engine = require("internal/desktop/dom/engine");
const { Element, iterable, kList, makeList, setIndexes } = require("internal/desktop/dom/node");
const { comparePoints, pointId, pointOffset, rangeRects } = require("internal/desktop/dom/range");

const { accessor, asciiLower, domError, expose, flags, hooks, illegalConstructor, splitTokens, wrapOrNull } = core;
const { STYLE_DIRTY, STYLE_UNSENT, CUSTOM, CONNECTED } = flags;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;

/** What a value is for each longhand: its source, which the engine gets, and its serialization. */
class Parsed {
  values: string[];
  /** There is something to substitute in the value of a shorthand. */
  isPending: boolean;

  constructor(values: string[], isPending: boolean) {
    this.values = values;
    this.isPending = isPending;
  }
}
const INVALID = new Parsed([], false);

const systemFont =
  /^\s*(?:caption|icon|menu|message-box|small-caption|status-bar|-webkit-(?:small-|mini-)?control)\s*$/i;

class Property {
  /** What an alias stands for. */
  name: string;
  longhands: string[];
  isShorthand: boolean;
  isCustom: boolean;
  /** Whether the order of the physical and the flow-relative properties of a group matters. */
  group: string;
  known = new Map<string, Parsed>();
  shorthands: string[] | null = null;

  constructor(name: string) {
    this.isCustom = name.startsWith("--");
    const found = this.isCustom ? [] : engine.longhands(name);
    this.longhands = found.length > 0 ? found : [name];
    this.isShorthand = found.length > 1 || name.includes("-break-") || name === "-webkit-mask-composite";
    this.name = this.isShorthand ? name : this.longhands[0];
    this.group = this.isShorthand || this.isCustom ? "" : groupOf(this.name);
  }

  parse(value: string, rule: string, priority: string): Parsed {
    let parsed = rule === "" ? this.known.$get(value) : undefined;
    if (parsed === undefined) {
      const values: string[] = engine.expandDeclaration(rule, this.name, value, priority !== "");
      parsed =
        values.length === 0
          ? INVALID
          : new Parsed(
              values,
              this.isShorthand && (values[0] !== "" || (this.name === "font" && systemFont.test(value))),
            );
      if (this.known.size >= MAX_KNOWN) this.known.$clear();
      if (rule === "") this.known.$set(value, parsed);
    }
    return parsed;
  }
}

const sides =
  /^((?:scroll-)?(?:margin|padding)|border)-(?:top|right|bottom|left|((?:block|inline)-(?:start|end)))(-width|-style|-color|)$/;
const axes =
  /^(min-|max-|contain-intrinsic-|)(?:width|height|((?:block|inline)-size))$|^(overflow|overscroll-behavior)-(?:x|y|(block|inline))$/;
const corners = /^(border|corner)-(?:top|bottom|(start|end))-\w+-(radius|shape)$/;

/** Starts with "p" for a physical property, and with "l" for a flow-relative one. */
function groupOf(name: string): string {
  let match = sides.exec(name) ?? corners.exec(name);
  if (match !== null) return (match[2] ? "l" : "p") + match[1] + match[3];
  if ((match = axes.exec(name)) !== null) return (match[2] || match[4] ? "l" : "p") + (match[1] ?? match[3]);
  if (name.startsWith("inset-")) return "linset";
  return name === "top" || name === "right" || name === "bottom" || name === "left" ? "pinset" : "";
}

const conflicts = (a: string, b: string) => a !== "" && a[0] !== b[0] && a.slice(1) === b.slice(1);
const wideKeywords = ["initial", "inherit", "unset", "revert", "revert-layer", "revert-rule"];

const MAX_KNOWN = 64;
const MAX_PROPERTIES = 4096;
const properties = new Map<string, Property>();

function property(name: string): Property {
  let found = properties.$get(name);
  if (found === undefined) {
    if (properties.size >= MAX_PROPERTIES) properties.$clear();
    properties.$set(name, (found = new Property(name)));
  }
  return found;
}

/** The declaration of a shorthand. */
class Origin {
  property: Property;
  source: string;
  isPending: boolean;

  constructor(property: Property, source: string, isPending: boolean) {
    this.property = property;
    this.source = source;
    this.isPending = isPending;
  }
}

const enum At {
  Name,
  Value,
  Priority,
  Source,
  Next,
}

const declaration = (name: string, value: string, priority: string) =>
  (name.charCodeAt(0) === 45 ? escape(name) : name) + ": " + value + (priority === "" ? ";" : " !important;");

class Declarations {
  /** Of longhands. */
  list: string[] | null = null;
  /** For each of them, once there are shorthands. */
  origins: (Origin | null)[] | null = null;
  /** The keyword of the rule, if it matters. */
  context = "";

  source(): string {
    return "";
  }
  willChange() {}
  changed() {}

  items(): string[] {
    if (this.list === null) this.parse(this.source());
    return this.list!;
  }

  parse(text: string) {
    const parsed = engine.parseDeclarations(text);
    this.list = [];
    this.origins = null;
    for (let i = 0; i < parsed.length; i += 3) {
      const it = propertyNamed(parsed[i]);
      const value = it.parse(parsed[i + 1], this.context, parsed[i + 2]);
      if (value !== INVALID) this.put(it, value, parsed[i + 1], parsed[i + 2], true);
    }
  }

  find(name: string): number {
    const list = this.items();
    for (let i = list.length - At.Next; i >= 0; i -= At.Next) if (list[i] === name) return i;
    return -1;
  }

  /** `null` if one is missing, or if their priorities differ. */
  findAll(it: Property): number[] | null {
    const list = this.items();
    if (list.length < it.longhands.length * At.Next) return null;
    const found: number[] = [];
    for (const name of it.longhands) {
      const index = this.find(name);
      if (index < 0 || (found.length > 0 && list[index + At.Priority] !== list[found[0] + At.Priority])) return null;
      found.push(index);
    }
    return found;
  }

  join(it: Property, found: number[]): string {
    const { origins } = this;
    const origin = origins === null ? null : origins[found[0] / At.Next];
    const isSystem = (index: number) =>
      it.name === "font-variant" && systemFont.test(origins![index / At.Next]?.source ?? "");
    if (origins !== null && found.some(index => origins[index / At.Next]?.isPending && !isSystem(index))) {
      const isWhole = found.every(index => origins[index / At.Next] === origin);
      return isWhole && String(origin!.property.longhands) === String(it.longhands) ? origin!.source : "";
    }
    const values = found.map(index => this.list![index + At.Value] || "normal");
    if (values.some(value => wideKeywords.includes(value)))
      return values.every(value => value === values[0]) ? values[0] : "";
    return engine.joinShorthand(it.name, values.join("\0"));
  }

  get(it: Property): string {
    if (it.isShorthand && !this.has(it.name)) {
      const found = this.findAll(it);
      return found === null ? "" : this.join(it, found);
    }
    const index = this.find(it.name);
    return index < 0 ? "" : this.list![index + At.Value];
  }

  /** The serialization, and what it is of. */
  typedValue(it: Property): string[] | null {
    const index = this.find(it.name);
    if (index >= 0) return [this.list![index + At.Value], this.list![index + At.Source]];
    const value = this.get(it);
    return value === "" ? null : [value, value];
  }

  has(name: string): boolean {
    return this.find(name) >= 0;
  }

  priority(it: Property): string {
    const index = it.isShorthand ? (this.findAll(it)?.[0] ?? -1) : this.find(it.name);
    return index < 0 ? "" : this.list![index + At.Priority];
  }

  drop(index: number) {
    this.list!.splice(index, At.Next);
    this.origins?.splice(index / At.Next, 1);
  }

  /** Whether it changes anything. */
  put(it: Property, { values, isPending }: Parsed, source: string, priority: string, isParsing: boolean): boolean {
    const list = this.list!;
    const isWhole = !it.isShorthand || (values.length === 3 && it.longhands.length > 1);
    const origin = isWhole ? null : new Origin(it, source, isPending);
    if (origin !== null) this.origins ??= new Array(list.length / At.Next).fill(null);
    const { origins } = this;
    let hasChanged = false;
    for (let i = 1; i < values.length; i += 2) {
      const name = isWhole ? it.name : it.longhands[i >> 1];
      const value = isPending ? "" : values[i + 1];
      let index = this.find(name);
      if (index >= 0) {
        if (isParsing && priority === "" && list[index + At.Priority] !== "") continue;
        const { group } = isWhole ? it : property(name);
        let moves = isParsing;
        if (group !== "") {
          for (let j = index + At.Next; j < list.length; j += At.Next)
            moves ||= conflicts(group, property(list[j]).group);
        }
        if (moves) {
          this.drop(index);
          index = -1;
        }
      }
      if (index < 0) {
        list.push(name, value, priority, values[i]);
        origins?.push(origin);
        hasChanged = true;
        continue;
      }
      hasChanged ||=
        list[index + At.Source] !== values[i] ||
        list[index + At.Value] !== value ||
        list[index + At.Priority] !== priority;
      list[index + At.Value] = value;
      list[index + At.Priority] = priority;
      list[index + At.Source] = values[i];
      if (origins !== null) origins[index / At.Next] = origin;
    }
    return hasChanged;
  }

  set(it: Property, value: string, priority: string) {
    if (value === "") return void this.remove(it);
    const list = this.items();
    if (!it.isShorthand) {
      const index = this.find(it.name);
      if (
        index >= 0 &&
        list[index + At.Source] === value &&
        list[index + At.Value] !== "" &&
        list[index + At.Priority] === priority &&
        it.group === ""
      )
        return;
    }
    const parsed = it.parse(value, this.context, priority);
    if (parsed === INVALID) return;
    this.willChange();
    if (this.put(it, parsed, value.trim(), priority, false)) this.changed();
  }

  /** From pairs of a name and a value. */
  setAll(values: string[]) {
    let hasChanged = false;
    this.items();
    this.willChange();
    for (let i = 0; i < values.length; i += 2) {
      const it = property(values[i]);
      if (this.priority(it) === "")
        hasChanged = this.put(it, it.parse(values[i + 1], "", ""), values[i + 1], "", false) || hasChanged;
    }
    if (hasChanged) this.changed();
  }

  remove(it: Property): string {
    const old = this.get(it);
    let hasChanged = false;
    for (const name of it.isShorthand && !this.has(it.name) ? it.longhands : [it.name]) {
      const index = this.find(name);
      if (index < 0) continue;
      if (!hasChanged) this.willChange();
      hasChanged = true;
      this.drop(index);
    }
    if (hasChanged) this.changed();
    return old;
  }

  names(): string[] {
    const list = this.items();
    const names: string[] = [];
    for (let i = 0; i < list.length; i += At.Next) names.push(list[i]);
    return names;
  }

  text(): string {
    const list = this.items();
    const all = property("all");
    const everything = this.findAll(all);
    const done = new Set<number>();
    const parts: string[] = [];
    const merge = (it: Property, found: number[] | null) => {
      if (found === null || found.some(index => done.$has(index))) return false;
      const value = this.join(it, found);
      if (value === "") return false;
      parts.push(declaration(it.name, value, list[found[0] + At.Priority]));
      for (const index of found) done.$add(index);
      return true;
    };
    for (let i = 0; i < list.length; i += At.Next) {
      if (done.$has(i) || (everything?.includes(i) && merge(all, everything))) continue;
      const it = property(list[i]);
      it.shorthands ??= it.isCustom ? [] : engine.shorthandsOf(it.name);
      if (it.shorthands!.some(name => merge(property(name), this.findAll(property(name))))) continue;
      parts.push(declaration(list[i], list[i + At.Value], list[i + At.Priority]));
    }
    return parts.join(" ");
  }

  /** It has all the digits, and the shorthands that have something to substitute. */
  engineText(): string {
    const list = this.items();
    const { origins } = this;
    let text = "";
    let after = "";
    for (let i = 0; i < list.length; i += At.Next) {
      const origin = origins === null ? null : origins[i / At.Next];
      const priority = list[i + At.Priority];
      if (origin === null) {
        after += " " + declaration(list[i], list[i + At.Source], priority);
        continue;
      }
      const { name, longhands } = origin.property;
      if (!origin.isPending) {
        if (longhands.every((longhand, at) => origins![i / At.Next + at] === origin)) {
          after += " " + declaration(name, origin.source, priority);
          i += (longhands.length - 1) * At.Next;
        } else after += " " + declaration(list[i], list[i + At.Source], priority);
      } else if (origins!.indexOf(origin) === i / At.Next) {
        text += " " + declaration(name, origin.source, priority);
        for (const longhand of longhands)
          if (!this.has(longhand)) text += " " + declaration(longhand, "revert-rule", priority);
      }
    }
    return (text + after).slice(1);
  }

  setText(text: string) {
    this.willChange();
    this.parse(text);
    this.changed();
  }
}

class InlineStyle extends Declarations {
  node: N;
  js: CSSStyleDeclaration;
  old: string | null = null;

  constructor(node: N) {
    super();
    this.node = node;
    if (node.doc.quirks) this.context = "quirks";
    this.js = wrapStyle(this);
  }
  source() {
    return this.node.rare?.isStyleRefused ? "" : (core.getAttr(this.node, "style") ?? "");
  }
  willChange() {
    const { node } = this;
    if (!(node.flags & CUSTOM || core.isOldStyleObserved(node))) return;
    this.old = node.flags & STYLE_DIRTY ? this.text() : core.getAttr(node, "style");
  }
  changed() {
    const { node } = this;
    const doc = node.doc;
    if (!(node.flags & STYLE_DIRTY) && !core.hasAttr(node, "style")) (node.attrs ??= []).push("style", "");
    if (!(node.flags & STYLE_UNSENT) && node.id !== 0) {
      doc.dirtyStyles.push(node);
      doc.needsSync = true;
      core.invalidate(doc);
    }
    const { rare } = node;
    if (rare !== null) rare.isStyleRefused = false;
    node.flags |= STYLE_DIRTY | STYLE_UNSENT;
    doc.attributeVersion++;
    if (doc.observed & 2) core.queueRecord(2, node, "style", null, this.old, null, null, null, null);
    if (node.flags & CUSTOM && node.rare!.definition!.observed.$has("style")) {
      core.enqueueReaction(node, "attributeChangedCallback", "style", this.old, core.getAttr(node, "style"), null);
      core.react();
    }
  }
}

declare global {
  namespace $Dom {
    type InlineStyle = InlineStyleImpl;
    type Sheet = SheetImpl;
  }
}
type InlineStyleImpl = InlineStyle;
type SheetImpl = Sheet;

hooks.flushStyle = (node: N) => {
  node.flags &= ~STYLE_DIRTY;
  node.attrs![core.attrIndex(node, "style") + 1] = node.style!.text();
};

hooks.sendStyle = (node: N, id: number) => {
  const style = node.style!;
  if (id === 0) return;
  node.flags &= ~STYLE_UNSENT;
  node.doc.engine.setAttribute(id, "style", style.list === null ? style.source() : style.engineText());
};

hooks.checkStyleAttribute = (node: N, value: string | null) => {
  const isRefused =
    value !== null && !node.doc.page!.host.allowsInline("style", value, undefined, true, core.wrap(node));
  core.rare(node).isStyleRefused = isRefused;
  const { id } = node;
  if (isRefused && id !== 0) node.doc.engine.removeAttribute(id, "style");
};

let computedNames: string[] | undefined;
const notComputed = /^(?:page|size|-webkit-(?:perspective|transform)-origin-)/;

class ComputedStyle {
  node: N;
  /** `null` if there is no such pseudo-element. */
  pseudo: string | null;

  constructor(node: N, pseudo: string | null) {
    this.node = node;
    this.pseudo = pseudo;
  }
  get({ name }: Property): string {
    const { node } = this;
    return this.isEmpty() ? "" : core.sync(node.doc).computedStyle(node.id, this.pseudo as any, name);
  }
  isEmpty() {
    return !(this.node.flags & CONNECTED) || this.node.id === 0 || this.pseudo === null;
  }
  typedValue({ name }: Property): string[] | null {
    const found = this.isEmpty() ? [] : core.sync(this.node.doc).computedValue(this.node.id, name);
    return found.length === 0 ? null : found;
  }
  priority() {
    return "";
  }
  names() {
    if (this.isEmpty()) return [];
    computedNames ??= engine
      .propertyNames()
      .filter((name: string) => property(name).name === name && !property(name).isShorthand && !notComputed.test(name))
      .sort((a: string, b: string) => +(a[0] === "-") - +(b[0] === "-") || (a < b ? -1 : 1));
    return computedNames!.concat(core.sync(this.node.doc).customPropertyNames(this.node.id, this.pseudo as any));
  }
  text() {
    return "";
  }
  set() {
    throw domError("NoModificationAllowedError", "These styles are computed, and therefore read-only.");
  }
  remove() {
    this.set();
  }
  setText() {
    this.set();
  }
}

function propertyNamed(given: unknown): Property {
  const name = typeof given === "string" ? given : String(given);
  return properties.$get(name) ?? property(name.startsWith("--") ? name : asciiLower(name));
}

let wrapped: Declarations | ComputedStyle | null = null;

class CSSStyleDeclaration {
  declare $impl: Declarations | ComputedStyle;

  constructor() {
    this.$impl = wrapped ?? illegalConstructor();
    wrapped = null;
  }
  get cssText() {
    return this.$impl.text();
  }
  set cssText(text) {
    this.$impl.setText(text === null ? "" : String(text));
  }
  get length() {
    return setIndexes(this, this.$impl.names());
  }
  get parentRule() {
    return (this.$impl as RuleStyle).rule?.js ?? null;
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.names()[index >>> 0] ?? "";
  }
  getPropertyValue(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.get(propertyNamed(name));
  }
  getPropertyPriority(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.priority(propertyNamed(name));
  }
  setProperty(name: string, value: string, priority = "") {
    if ($argumentCount() < 2) core.tooFew(2);
    if (priority !== "") priority = asciiLower(String(priority ?? ""));
    if (priority !== "" && priority !== "important") return;
    this.$impl.set(propertyNamed(name), value === null ? "" : String(value), priority);
  }
  removeProperty(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.remove(propertyNamed(name));
  }
}
iterable(CSSStyleDeclaration, false);
expose(CSSStyleDeclaration);

const camelCase = (name: string) => name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

const styleText = (value: unknown) => (typeof value === "string" ? value : value === null ? "" : `${value}`);

function defineOftenUsed(name: string) {
  const it = property(name);
  accessor(
    CSSStyleDeclaration.prototype,
    camelCase(name),
    function (this: CSSStyleDeclaration) {
      return this.$impl.get(it);
    },
    function (this: CSSStyleDeclaration, value) {
      this.$impl.set(it, styleText(value), "");
    },
  );
}

const byMember = new Map<string, Property>();

function propertyOfMember(member: string): Property {
  let found = byMember.$get(member);
  if (found === undefined) {
    const name =
      member === "cssFloat" ? "float" : member.replace(/^webkit(?=[A-Z])|[A-Z]/g, it => "-" + it.toLowerCase());
    byMember.$set(member, (found = property(name)));
  }
  return found;
}

core.setAccessorFamily(
  core.families.STYLE,
  (self: CSSStyleDeclaration, member: string) => self.$impl.get(propertyOfMember(member)),
  (self: CSSStyleDeclaration, member: string, value: unknown) =>
    self.$impl.set(propertyOfMember(member), styleText(value), ""),
);
core.defineAccessors(CSSStyleDeclaration.prototype, ["cssFloat"], core.families.STYLE, true);

function defineProperties() {
  const oftenUsed = splitTokens(`bottom color display height left max-height max-width min-height min-width opacity
    overflow pointer-events position right top transform visibility width z-index`);
  const members: string[] = [];
  const dashed: string[] = [];
  for (const name of engine.propertyNames()) {
    const camel = camelCase(name);
    if (!oftenUsed.includes(name)) members.push(camel);
    if (name[0] === "-") members.push(camel[0].toLowerCase() + camel.slice(1));
    if (camel !== name) dashed.push(name);
  }
  oftenUsed.forEach(defineOftenUsed);
  core.defineAccessors(CSSStyleDeclaration.prototype, members, core.families.STYLE, true);
  core.defineAccessors(CSSStyleDeclaration.prototype, dashed, core.families.STYLE, false);
}

let hasProperties = false;
function wrapStyle(data: Declarations | ComputedStyle, ctor = CSSStyleDeclaration): CSSStyleDeclaration {
  if (!hasProperties) {
    hasProperties = true;
    defineProperties();
  }
  wrapped = data;
  return new ctor();
}

function styleOf(node: N) {
  return (node.style ??= new InlineStyle(node)).js;
}

function computedStyle(node: N, pseudo: string) {
  return wrapStyle(new ComputedStyle(node, pseudo[0] === ":" ? engine.parsePseudoElement(pseudo) || null : ""));
}

const typed = () => require("internal/desktop/dom/typed");
for (const name of splitTokens(`StyleValue ImageValue KeywordValue UnparsedValue VariableReferenceValue PositionValue NumericValue
  UnitValue NumericArray MathValue MathSum MathProduct MathMin MathMax MathClamp MathNegate MathInvert TransformValue
  TransformComponent Translate Rotate Scale Skew SkewX SkewY Perspective MatrixComponent`)
  .map(name => "CSS" + name)
  .concat("StylePropertyMapReadOnly", "StylePropertyMap")) {
  new core.Interface(name, () => typed() && core.interfaces[name]);
}

function styleMap(style: any, isWritable: boolean) {
  return typed().styleMap(style.$impl ?? style, isWritable);
}

/** `null` if it is invalid. */
function canonicalValue(name: string, value: string): string | null {
  const it = property(name);
  const { values, isPending } = it.parse(value, "", "");
  if (values.length === 0) return null;
  if (!it.isShorthand || isPending) return values[2];
  const scratch = new Declarations();
  scratch.set(it, value, "");
  return scratch.get(it);
}

function parseFont(value: string) {
  const { values, isPending } = property("font").parse(value, "", "");
  if (systemFont.test(value)) return { families: [], weight: 400, isItalic: false };
  if (values.length === 0 || isPending || wideKeywords.includes(values[2])) return null;
  const scratch = new Declarations();
  scratch.set(property("font"), value, "");
  const weight = scratch.get(property("font-weight"));
  return {
    families: engine.splitValue(scratch.get(property("font-family")), true),
    weight: parseFloat(weight) || (weight.startsWith("bold") ? 700 : weight === "lighter" ? 100 : 400),
    isItalic: scratch.get(property("font-style")) !== "normal",
  };
}

class CSSPseudoElement {
  declare $impl: { element: N; parent: object; type: string; inner: Map<string, object> };

  constructor() {
    illegalConstructor();
  }
  get type() {
    return this.$impl.type;
  }
  get element() {
    return core.wrap(this.$impl.element);
  }
  get parent() {
    return this.$impl.parent;
  }
  pseudo(type: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const { element, inner } = this.$impl;
    const isNested = (this.type === "::before" || this.type === "::after") && asciiLower(String(type)) === "::marker";
    return isNested ? makePseudoElement(inner, element, this, "::marker") : null;
  }
}
expose(CSSPseudoElement);

function makePseudoElement(known: Map<string, object>, element: N, parent: object, type: string): object {
  let made = known.$get(type);
  if (made === undefined) {
    known.$set(type, (made = Object.create(CSSPseudoElement.prototype) as object));
    $putByIdDirectPrivate(made as any, "impl", { element, parent, type: type.replace(/\(.*/, ""), inner: new Map() });
  }
  return made;
}

const pseudoElements = new WeakMap<N, Map<string, object>>();
hooks.pseudoElement = (node, given) => {
  const type: string = engine.parsePseudoElement(given.trim());
  if (!/^::(?:before|after|marker|backdrop|scroll-marker|view-transition.*)$/.test(type)) return null;
  if (!pseudoElements.has(node)) pseudoElements.set(node, new Map());
  return makePseudoElement(pseudoElements.get(node)!, node, core.wrap(node), type);
};
core.mixin(
  {
    pseudo(this: any, type: string) {
      if ($argumentCount() < 1) core.tooFew(1);
      core.brand(this);
      return hooks.pseudoElement(this.$impl, String(type));
    },
  },
  Element,
);

// ───────────────────────────── rules ─────────────────────────────

class RuleStyle extends Declarations {
  rule: Rule;
  constructor(rule: Rule) {
    super();
    this.rule = rule;
    if (rule.sheet?.owner?.doc.quirks) this.context = "quirks";
    for (let at: Rule | null = rule; at !== null; at = at.parent) {
      const { keyword } = at;
      if (ownDescriptors.includes(keyword)) this.context = keyword;
    }
  }
  source() {
    this.rule.rules();
    return this.rule.declarations;
  }
  changed() {
    this.rule.touch();
  }
}

const orNull = (text: string) => (text === "\0" ? null : text);

class Rule {
  sheet: Sheet | null;
  parent: Rule | null;
  /** Without the `@`. "" for a style rule, a keyframe, and declarations, which have no prelude. */
  keyword: string;
  prelude: string;
  /** Of the prelude. */
  parts: string[];
  body: string | null;
  declarations = "";
  children: Rule[] | null = null;
  style: RuleStyle | null = null;
  styleJs: any = null;
  styleMap: any = null;
  list: any = null;
  media: any = null;
  wrapper: any = null;
  features: Map<string, any> | null = null;

  constructor(sheet: Sheet | null, parent: Rule | null, parsed: string[], body: string | null) {
    this.sheet = sheet;
    this.parent = parent;
    this.keyword = parsed[0] === "-webkit-keyframes" ? "keyframes" : parsed[0];
    this.prelude = parsed[1];
    this.parts = parsed.slice(2);
    this.body = body;
  }

  get js() {
    if (this.wrapper === null) {
      const parent = this.parent?.context();
      let ctor = ruleClasses[this.keyword] ?? CSSMarginRule;
      if (this.keyword === "layer" && this.body === null) ctor = CSSLayerStatementRule;
      else if (parent === "keyframes") ctor = CSSKeyframeRule;
      else if (this.isDeclarations()) ctor = parent === "function" ? CSSFunctionDeclarations : CSSNestedDeclarations;
      $putByIdDirectPrivate((this.wrapper = Object.create(ctor.prototype)), "impl", this);
    }
    return this.wrapper;
  }

  isDeclarations() {
    return this.keyword === "" && this.prelude === "";
  }

  /** What `parsePrelude` calls the parent of the rules in this one. */
  context(): string {
    for (let at: Rule | null = this; at !== null; at = at.parent) {
      if (at.keyword === "") return "style";
      const { keyword } = at;
      if (!groupKeywords.includes(keyword) || keyword === "scope" || keyword === "keyframes") return keyword;
    }
    return "";
  }

  rules(): Rule[] {
    const ownChildren = this.children;
    if (ownChildren !== null) return ownChildren;
    const children: Rule[] = (this.children = []);
    const context = this.context();
    const parts = engine.splitRules(this.body ?? "", context !== "" && context !== "keyframes", true);
    let owner: Rule | null = groupKeywords.includes(this.keyword) || this.keyword === "function" ? null : this;
    for (let i = 0; i < parts.length; i += 3) {
      if (parts[i + 1] !== "") {
        const rule = makeRule(this.sheet, this, parts[i], parts[i + 1] === "{" ? parts[i + 2] : null);
        if (rule !== null && rank(rule) === 2) children.push(rule);
        if (rule !== null && (owner !== this || this.keyword === "")) owner = null;
      } else if (context !== "" && context !== "keyframes") {
        if (owner === null) children.push((owner = makeDeclarations(this, "")));
        owner.declarations += parts[i];
      }
    }
    return (this.children = children.filter(rule => !rule.isDeclarations() || rule.getStyle().items().length > 0));
  }

  setPrelude(prelude: string): boolean {
    const parsed = parsePrelude(
      this.sheet,
      this.parent,
      this.keyword === "" ? prelude : `@${this.keyword} ${prelude}`,
      "",
    );
    if (parsed.length === 0 || parsed[0] !== this.keyword) return false;
    this.prelude = parsed[1];
    this.parts = parsed.slice(2);
    this.touch();
    return true;
  }

  detach() {
    this.sheet = null;
    for (const child of this.children ?? []) child.detach();
  }

  getStyle(): RuleStyle {
    return (this.style ??= new RuleStyle(this));
  }

  descriptor(name: string): string {
    return this.getStyle().get(property(name));
  }

  touch() {
    this.sheet?.rulesChanged(null);
  }

  text(forEngine: boolean): string {
    const { keyword } = this;
    let head = keyword === "" ? this.prelude : ("@" + keyword + " " + this.prelude).trimEnd();
    const { parts } = this;
    if (keyword === "import" && parts[3] !== "") head += " " + parts[3];
    if (this.body === null) return head + ";";
    if (forEngine && this.children === null && this.style === null && this.features === null)
      return `${head}{${this.body}}`;
    const nested =
      keyword === "font-feature-values" ? featureBlocks(this) : this.rules().map(rule => rule.text(forEngine));
    let own: string;
    if (forEngine) own = this.style?.engineText() ?? this.declarations;
    else if (keyword in descriptorOrders) {
      const present = descriptorOrders[keyword].filter(name => this.getStyle().has(name));
      own = present.map(name => declaration(name, this.descriptor(name), "")).join(" ");
    } else own = this.getStyle().text();
    if (head === "") return own;
    const all = [own, ...nested].filter(Boolean);
    if (keyword === "keyframes") return `${head} { \n${all.map(it => `  ${it}\n`).join("")}}`;
    if (groupKeywords.includes(keyword) || (keyword === "" && nested.length > 0)) {
      return `${head} {${all.map(it => "\n  " + it).join("")}\n}`;
    }
    return `${head} { ${all.map(it => it + " ").join("")}}`;
  }
}

function parsePrelude(sheet: Sheet | null, parent: Rule | null, prelude: string, body: string | null): string[] {
  return engine.parsePrelude(prelude, parent?.context() ?? "", body, sheet?.namespaces ?? "");
}

function makeRule(sheet: Sheet | null, parent: Rule | null, prelude: string, body: string | null): Rule | null {
  const parsed = parsePrelude(sheet, parent, prelude, body);
  return parsed.length === 0 ? null : new Rule(sheet, parent, parsed, body);
}

function makeDeclarations(parent: Rule, declarations: string): Rule {
  const rule = new Rule(parent.sheet, parent, ["", ""], "");
  rule.children = [];
  rule.declarations = declarations;
  return rule;
}

function parseRule(sheet: Sheet | null, parent: Rule | null, text: string): Rule {
  const parts = engine.splitRules(text, false, false);
  let rule =
    parts.length === 3 && parts[1] !== ""
      ? makeRule(sheet, parent, parts[0], parts[1] === "{" ? parts[2] : null)
      : null;
  if (rule === null && (parent?.context() === "style" || parent?.context() === "scope")) {
    rule = makeDeclarations(parent!, text);
    if (rule.getStyle().items().length === 0) rule = null;
  }
  if (rule === null) throw domError("SyntaxError", `Failed to parse the rule '${text}'.`);
  return rule;
}

const rank = (rule: Rule) => (rule.keyword === "import" ? 0 : rule.keyword === "namespace" ? 1 : 2);
const isLayerStatement = (rule: Rule) => rule.keyword === "layer" && rule.body === null;

function insertRule(rules: Rule[], rule: Rule, index: number) {
  const before = rules.findLast((it, at) => at < index && !isLayerStatement(it));
  let after = index;
  while (after < rules.length && isLayerStatement(rules[after])) after++;
  const isOutOfPlace =
    (rank(rule) < 2 && rule.parent !== null) ||
    (before !== undefined && rank(before) > rank(rule)) ||
    (after < rules.length && rank(rules[after]) < rank(rule) && !isLayerStatement(rule));
  if (rank(rule) === 1 && rule.parent === null && rules.some(it => rank(it) === 2)) {
    throw domError("InvalidStateError", "An @namespace rule cannot be added after other rules.");
  }
  if (isOutOfPlace) throw domError("HierarchyRequestError", "The rule cannot be inserted here.");
  rules.splice(index, 0, rule);
}

function checkIndex(index: number, limit: number) {
  if (index > limit) throw domError("IndexSizeError", `The index provided (${index}) is outside of the range.`);
}

class CSSRuleList {
  constructor() {
    illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
}
iterable(CSSRuleList, false);
expose(CSSRuleList);

function ruleList(owner: Rule | Sheet) {
  return (owner.list ??= makeList(CSSRuleList, {
    size: () => owner.rules().length,
    at: index => owner.rules()[index]?.js,
  }));
}

class MediaList {
  constructor() {
    illegalConstructor();
  }
  get mediaText() {
    return this[kList].get();
  }
  set mediaText(text) {
    this[kList].put(text === null ? "" : String(text));
  }
  get length() {
    return this[kList].size();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
  appendMedium(medium: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const parsed = engine.parseMedia(String(medium));
    if (parsed.length === 1 && !this[kList].items().includes(parsed[0]))
      this[kList].put([...this[kList].items(), ...parsed].join());
  }
  deleteMedium(medium: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const parsed = engine.parseMedia(String(medium));
    if (parsed.length !== 1) return;
    if (!this[kList].items().includes(parsed[0])) throw domError("NotFoundError", `Failed to delete '${medium}'.`);
    this[kList].put(
      this[kList]
        .items()
        .filter(it => it !== parsed[0])
        .join(),
    );
  }
  toString() {
    return this[kList].get();
  }
}
iterable(MediaList, false);
expose(MediaList);

function mediaList(source: () => string, put: (text: string) => void) {
  const items = (): string[] => engine.parseMedia(source());
  return makeList(MediaList, {
    get: () => items().join(", "),
    put,
    items,
    size: () => items().length,
    at: index => items()[index],
  });
}

class CSSRule {
  declare $impl: Rule;

  constructor() {
    illegalConstructor();
  }
  get type() {
    const { keyword, prelude, parent } = this.$impl;
    if (keyword === "") return parent?.keyword === "keyframes" ? 8 : prelude === "" ? 0 : 1;
    return parent?.keyword === "page" ? 9 : (ruleTypes[keyword] ?? 0);
  }
  get cssText() {
    return this.$impl.text(false);
  }
  set cssText(_) {
    void this.$impl.parent;
  }
  get parentRule() {
    return this.$impl.parent?.js ?? null;
  }
  get parentStyleSheet() {
    return this.$impl.sheet?.js ?? null;
  }
}
const ruleTypes = {
  __proto__: null,
  import: 3,
  media: 4,
  "font-face": 5,
  page: 6,
  keyframes: 7,
  namespace: 10,
  "counter-style": 11,
  supports: 12,
  "font-feature-values": 14,
  "view-transition": 0,
};
expose(CSSRule, {
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
});

class CSSGroupingRule extends CSSRule {
  get cssRules() {
    return ruleList(this.$impl);
  }
  insertRule(text: string, index = 0) {
    const self: Rule = this.$impl;
    if ($argumentCount() < 1) core.tooFew(1);
    checkIndex((index >>>= 0), self.rules().length);
    insertRule(self.rules(), parseRule(self.sheet, self, String(text)), index);
    self.touch();
    return index;
  }
  deleteRule(index: number) {
    const self: Rule = this.$impl;
    if ($argumentCount() < 1) core.tooFew(1);
    checkIndex((index >>>= 0), self.rules().length - 1);
    const [rule] = self.rules().splice(index, 1);
    rule.detach();
    rule.parent = null;
    self.touch();
  }
}

function defineStyle(ctor: any, declarations: any) {
  const get = function (this: CSSRule) {
    return (this.$impl.styleJs ??= wrapStyle(this.$impl.getStyle(), declarations));
  };
  accessor(ctor.prototype, "style", get, function (this: CSSRule, text: string) {
    get.$call(this).cssText = text;
  });
}

/** `part` is an index into `Rule.parts`, or -1 for all of the prelude. */
function definePrelude(ctor: any, name: string, part: number, toPrelude?: (value: string) => string) {
  accessor(
    ctor.prototype,
    name,
    function (this: CSSRule) {
      return orNull(part < 0 ? this.$impl.prelude : (this.$impl.parts[part] ?? ""));
    },
    toPrelude &&
      function (this: CSSRule, value) {
        this.$impl.setPrelude(toPrelude(String(value)));
      },
  );
}

function defineDescriptors(ctor: any, names: string[], write?: (rule: Rule, name: string, value: string) => void) {
  for (const name of names) {
    accessor(
      ctor.prototype,
      camelCase(name),
      function (this: CSSRule) {
        return this.$impl.descriptor(name);
      },
      write &&
        function (this: CSSRule, value) {
          write(this.$impl, name, String(value));
        },
    );
  }
}

/** `part` is the index of the media query list in `Rule.parts`, or -1 if it is the prelude. */
function defineMedia(ctor: any, part: number) {
  const get = function (this: CSSRule) {
    const rule = this.$impl;
    return (rule.media ??= mediaList(
      () => (part < 0 ? rule.prelude : rule.parts[part]),
      text => {
        text = engine.parseMedia(text).join(", ");
        if (part < 0) rule.prelude = text;
        else setMedia(importedBy(rule), (rule.parts[part] = text));
        rule.touch();
      },
    ));
  };
  accessor(ctor.prototype, "media", get, function (this: CSSRule, text: string) {
    get.$call(this).mediaText = text;
  });
}

class CSSStyleRule extends CSSGroupingRule {
  get styleMap() {
    return (this.$impl.styleMap ??= styleMap(this.$impl.getStyle(), true));
  }
}
class CSSConditionRule extends CSSGroupingRule {}
class CSSMediaRule extends CSSConditionRule {}
class CSSSupportsRule extends CSSConditionRule {}
class CSSContainerRule extends CSSConditionRule {
  get containerName() {
    return this.$impl.parts.length === 2 ? this.$impl.parts[0] : "";
  }
  get containerQuery() {
    return this.$impl.parts.length === 2 ? this.$impl.parts[1] : "";
  }
  get conditions() {
    const { parts } = this.$impl;
    const names = parts.filter((_, index) => index % 2 === 0);
    return (this.$impl.media ??= Object.freeze(names.map((name, index) => ({ name, query: parts[index * 2 + 1] }))));
  }
}
class CSSLayerBlockRule extends CSSGroupingRule {}
class CSSLayerStatementRule extends CSSRule {
  get nameList() {
    return (this.$impl.list ??= Object.freeze(this.$impl.parts.slice()));
  }
}
class CSSScopeRule extends CSSGroupingRule {}
class CSSStartingStyleRule extends CSSGroupingRule {}
class CSSPageRule extends CSSGroupingRule {}
class CSSMarginRule extends CSSRule {
  get name() {
    return this.$impl.keyword;
  }
}
class CSSFontFaceRule extends CSSRule {}
class CSSFontPaletteValuesRule extends CSSRule {}
class CSSPositionTryRule extends CSSRule {}
class CSSCounterStyleRule extends CSSRule {}
class CSSNestedDeclarations extends CSSRule {}
class CSSFunctionDeclarations extends CSSRule {}
class CSSFunctionRule extends CSSGroupingRule {
  get returnType() {
    return this.$impl.parts[1];
  }
  getParameters() {
    const { parts } = this.$impl;
    const all: object[] = [];
    for (let i = 2; i < parts.length; i += 3) {
      const given = parts[i + 2] === "\0" ? {} : { defaultValue: parts[i + 2] };
      all.push({ ...given, name: parts[i], type: parts[i + 1] });
    }
    return all;
  }
}
class CSSViewTransitionRule extends CSSRule {
  get types() {
    const types = this.$impl.descriptor("types");
    return (this.$impl.list ??= Object.freeze(types === "none" ? [] : splitTokens(types)));
  }
}
class CSSKeyframeRule extends CSSRule {
  get keyText() {
    return this.$impl.prelude;
  }
  set keyText(text) {
    if (!this.$impl.setPrelude(String(text)))
      throw domError("SyntaxError", `The key '${text}' is invalid and cannot be parsed`);
  }
}
function findKeyframe(rule: Rule, key: string): number {
  const wanted = parsePrelude(null, rule, String(key), "")[1];
  return rule.rules().findLastIndex(it => it.prelude === wanted);
}
class CSSKeyframesRule extends CSSRule {
  get name() {
    return this.$impl.parts[0];
  }
  set name(name) {
    const text = (this.$impl.parts[0] = String(name));
    this.$impl.prelude =
      text === "" || /^(?:none|default)$/i.test(text) || wideKeywords.includes(asciiLower(text))
        ? `"${text}"`
        : escape(text);
    this.$impl.touch();
  }
  get cssRules() {
    return ruleList(this.$impl);
  }
  get length() {
    return setIndexes(
      this,
      this.$impl.rules().map(rule => rule.js),
    );
  }
  appendRule(text: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const { sheet } = this.$impl;
    const parts = engine.splitRules(String(text), false, false);
    const rule = parts.length === 3 && parts[1] === "{" ? makeRule(sheet, this.$impl, parts[0], parts[2]) : null;
    if (rule === null) return;
    this.$impl.rules().push(rule);
    this.$impl.touch();
  }
  findRule(key: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.rules()[findKeyframe(this.$impl, key)]?.js ?? null;
  }
  deleteRule(key: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const index = findKeyframe(this.$impl, key);
    if (index < 0) return;
    const [rule] = this.$impl.rules().splice(index, 1);
    rule.detach();
    rule.parent = null;
    this.$impl.touch();
  }
}
iterable(CSSKeyframesRule, false);

function importedBy({ sheet, parts }: Rule): Sheet | null {
  const url = URL.parse(parts[0], sheet?.baseUrl)?.href;
  return sheet?.imports.find(it => it.href === url) ?? null;
}
class CSSImportRule extends CSSRule {
  get styleSheet() {
    return importedBy(this.$impl)?.js ?? null;
  }
}
class CSSNamespaceRule extends CSSRule {}
class CSSPropertyRule extends CSSRule {
  get syntax() {
    return this.$impl.descriptor("syntax").slice(1, -1);
  }
  get inherits() {
    return this.$impl.descriptor("inherits") === "true";
  }
  get initialValue() {
    return this.$impl.getStyle().has("initial-value") ? this.$impl.descriptor("initial-value") : null;
  }
}

const featureKinds = splitTokens("annotation ornaments stylistic swash character-variant styleset");
const mostValues = (kind: string) => (kind === "styleset" ? 20 : kind === "character-variant" ? 2 : 1);

class CSSFontFeatureValuesMap extends Map<string, number[]> {
  declare $impl: [Rule, string];

  set(name: string, values: number | number[]) {
    const list = $isObject(values) ? Array.from(values as number[], it => it >>> 0) : [(values as number) >>> 0];
    if (list.length === 0 || list.length > mostValues(this.$impl[1])) {
      throw domError("InvalidAccessError", "The number of values is not valid for this feature.");
    }
    super.set(String(name), list);
    this.$impl[0].touch();
    return this;
  }
  delete(name: string) {
    this.$impl[0].touch();
    return super.delete(String(name));
  }
  clear() {
    this.$impl[0].touch();
    super.clear();
  }
}
function featuresOf(rule: Rule): Map<string, CSSFontFeatureValuesMap> {
  const ruleFeatures = rule.features;
  if (ruleFeatures !== null) return ruleFeatures;
  const features = (rule.features = new Map());
  for (const kind of featureKinds) {
    const map = new CSSFontFeatureValuesMap();
    map.$impl = [rule, kind];
    features.$set(kind, map);
  }
  for (const { keyword, body } of rule.rules()) {
    const parsed = engine.parseDeclarations(body as any);
    for (let i = 0; i < parsed.length; i += 3) {
      const values = splitTokens(parsed[i + 1]);
      if (parsed[i + 2] !== "" || values.length === 0 || values.length > mostValues(keyword)) continue;
      if (values.every(it => /^\+?\d+$/.test(it))) features.$get(keyword).$set(parsed[i], values.map(Number));
    }
  }
  return features;
}
function featureBlocks(rule: Rule): string[] {
  const blocks = Array.from(featuresOf(rule)).filter(([, map]) => map.size > 0);
  return blocks.map(
    ([kind, map]) => `@${kind} { ${Array.from(map, ([name, it]) => `${escape(name)}: ${it.join(" ")}; `).join("")}}`,
  );
}
class CSSFontFeatureValuesRule extends CSSRule {}
for (const kind of featureKinds) {
  accessor(CSSFontFeatureValuesRule.prototype, camelCase(kind), function (this: CSSRule) {
    return featuresOf(this.$impl).$get(kind);
  });
}

const descriptorOrders = {
  __proto__: null,
  "counter-style": splitTokens("system symbols additive-symbols negative prefix suffix pad range fallback speak-as"),
  "font-palette-values": splitTokens("font-family base-palette override-colors"),
  property: splitTokens("syntax inherits initial-value"),
  "view-transition": splitTokens("navigation types"),
};
const ownDescriptors = [
  ...Object.keys(descriptorOrders),
  ...splitTokens("font-face function keyframes page position-try"),
];
const groupKeywords = splitTokens("media supports container layer scope starting-style keyframes");

const oneSymbol = /^(?:\x22(?:[^\x22\\]|\\.)*\x22|\S+)$/;
const algorithm = (system: string) => system.split(" ")[0] || "symbolic";
function setCounterDescriptor(rule: Rule, name: string, value: string) {
  const system = algorithm(rule.descriptor("system"));
  const parsed = property(name).parse(value, rule.keyword, "").values[2];
  if (parsed === undefined || (name === "system" && algorithm(parsed) !== system)) return;
  if (name.endsWith("symbols") && system === "extends") return;
  if (name === "symbols" && (system === "alphabetic" || system === "numeric") && oneSymbol.test(parsed)) return;
  rule.getStyle().set(property(name), value, "");
}

class CSSPositionTryDescriptors extends CSSStyleDeclaration {}
{
  const logical = ["", "-block", "-block-start", "-block-end", "-inline", "-inline-start", "-inline-end"];
  const names = [
    ...splitTokens(`margin-top margin-right margin-bottom margin-left top right bottom left place-self align-self justify-self
      position-anchor position-area`),
    ...logical.flatMap(it => ["margin" + it, "inset" + it]),
    ...splitTokens("width height block-size inline-size").flatMap(it => [it, "min-" + it, "max-" + it]),
  ];
  core.defineAccessors(
    CSSPositionTryDescriptors.prototype,
    [...new Set([...names, ...names.map(camelCase)])],
    core.families.STYLE,
    true,
  );
}
class CSSFunctionDescriptors extends CSSStyleDeclaration {
  get result() {
    return this.$impl.get(property("result"));
  }
  set result(value) {
    this.$impl.set(property("result"), styleText(value), "");
  }
}
for (const ctor of [
  CSSStyleRule,
  CSSPageRule,
  CSSMarginRule,
  CSSFontFaceRule,
  CSSNestedDeclarations,
  CSSKeyframeRule,
]) {
  defineStyle(ctor, CSSStyleDeclaration);
}
defineStyle(CSSPositionTryRule, CSSPositionTryDescriptors);
defineStyle(CSSFunctionDeclarations, CSSFunctionDescriptors);
for (const ctor of [CSSStyleRule, CSSPageRule]) definePrelude(ctor, "selectorText", -1, String);
definePrelude(CSSConditionRule, "conditionText", -1);
definePrelude(CSSCounterStyleRule, "name", 0, escape);
definePrelude(CSSFontFeatureValuesRule, "fontFamily", -1, String);
definePrelude(CSSLayerBlockRule, "name", -1);
for (const ctor of [CSSPropertyRule, CSSPositionTryRule, CSSFontPaletteValuesRule, CSSFunctionRule])
  definePrelude(ctor, "name", 0);
["start", "end"].forEach((name, index) => definePrelude(CSSScopeRule, name, index));
["prefix", "namespaceURI"].forEach((name, index) => definePrelude(CSSNamespaceRule, name, index));
["href", "layerName", "supportsText"].forEach((name, index) => definePrelude(CSSImportRule, name, index));
defineMedia(CSSMediaRule, -1);
defineMedia(CSSImportRule, 3);
defineDescriptors(CSSCounterStyleRule, descriptorOrders["counter-style"], setCounterDescriptor);
defineDescriptors(CSSFontPaletteValuesRule, descriptorOrders["font-palette-values"]);
defineDescriptors(CSSViewTransitionRule, ["navigation"]);

const ruleClasses = {
  __proto__: null,
  "": CSSStyleRule,
  media: CSSMediaRule,
  supports: CSSSupportsRule,
  container: CSSContainerRule,
  layer: CSSLayerBlockRule,
  scope: CSSScopeRule,
  "starting-style": CSSStartingStyleRule,
  page: CSSPageRule,
  "font-face": CSSFontFaceRule,
  "font-feature-values": CSSFontFeatureValuesRule,
  "font-palette-values": CSSFontPaletteValuesRule,
  function: CSSFunctionRule,
  "position-try": CSSPositionTryRule,
  "counter-style": CSSCounterStyleRule,
  keyframes: CSSKeyframesRule,
  import: CSSImportRule,
  namespace: CSSNamespaceRule,
  property: CSSPropertyRule,
  "view-transition": CSSViewTransitionRule,
};
for (const ctor of [CSSGroupingRule, CSSConditionRule, CSSLayerStatementRule, CSSNestedDeclarations, CSSKeyframeRule]) {
  expose(ctor);
}
for (const ctor of [CSSMarginRule, CSSFunctionDeclarations, CSSFunctionDescriptors, CSSPositionTryDescriptors])
  expose(ctor);
expose(CSSFontFeatureValuesMap);
Object.values(ruleClasses).forEach(ctor => expose(ctor!));

// ───────────────────────────── sheets ─────────────────────────────

const MAX_CHUNKS = 24;

function readable(sheet: Sheet) {
  if (sheet.isTainted) throw domError("SecurityError", "Cannot access the rules of a style sheet of another origin.");
  return sheet;
}

class Sheet {
  isTainted = false;
  encoding: string | null = null;
  referrerPolicy: string | undefined = undefined;
  wrapper: any = null;
  owner: N | null = null;
  parent: Sheet | null = null;
  href: string | null = null;
  baseUrl: string;
  mediaText = "";
  disabled = false;
  title = "";
  isConstructed = false;
  /** That it was constructed for. */
  doc: Doc | null = null;
  /** What an imported sheet is wrapped in. */
  prelude = "";
  /** Together they are the text of the sheet. `insertRule` at the end adds to the last one. */
  chunks: string[];
  /** In place of the first one: UTF-8, and then nothing, while an engine has it. */
  bytes: Uint8Array | null = null;
  isInEngine = false;
  /** How many of them an engine has seen, and their ids there. */
  compiled = new Map<any, number[]>();
  isLastChunkOpen = false;
  parsed: Rule[] | null = null;
  isStale = false;
  /** For `parsePrelude`. */
  namespaces = "";
  isDisposed = false;
  imports: Sheet[] = [];
  /** The rendered ones that have adopted it. */
  scopes = new Set<N>();
  list: any = null;
  media: any = null;

  constructor(text: string, baseUrl: string) {
    this.chunks = [text];
    this.baseUrl = baseUrl;
  }

  get js() {
    if (this.wrapper === null) {
      $putByIdDirectPrivate((this.wrapper = Object.create(CSSStyleSheet.prototype)), "impl", this);
    }
    return this.wrapper;
  }

  load() {
    const { bytes } = this;
    if (bytes !== null) this.chunks[0] = new TextDecoder().decode(bytes);
    else if (this.isInEngine) for (const [engine, ids] of this.compiled) this.chunks[0] = engine.sheetSource(ids[0]);
    this.bytes = null;
    this.isInEngine = false;
  }

  rules(): Rule[] {
    this.load();
    const { parsed } = this;
    if (parsed !== null) return parsed;
    const rules: Rule[] = (this.parsed = []);
    const parts = engine.splitRules(this.chunks[0], false, false);
    this.namespaces = "";
    let latest = 0;
    for (let i = 0; i < parts.length; i += 3) {
      const rule =
        parts[i + 1] === "" ? null : makeRule(this, null, parts[i], parts[i + 1] === "{" ? parts[i + 2] : null);
      if (rule === null || rank(rule) < latest || (this.isConstructed && rule.keyword === "import")) continue;
      if (!isLayerStatement(rule) || rules.some(it => rank(it) < 2)) latest = rank(rule);
      rules.push(rule);
      if (rule.keyword === "namespace") this.namespacesChanged();
    }
    return rules;
  }

  namespacesChanged() {
    this.namespaces = this.parsed!.map(it => (it.keyword === "namespace" ? it.parts.join("\0") + "\0" : "")).join("");
  }

  changed(): any {
    const { parent } = this;
    if (parent !== null) return parent.changed();
    const { owner } = this;
    if (owner?.scope) core.dirtyScope(owner.scope);
    for (const scope of this.scopes) if (scope.id !== 0) core.dirtyScope(scope);
  }

  rulesChanged(appended: string | null) {
    if (appended === null || this.chunks.length >= MAX_CHUNKS) this.isStale = true;
    else if (this.isLastChunkOpen) this.chunks[this.chunks.length - 1] += "\n" + appended;
    else this.chunks.push(appended);
    this.isLastChunkOpen = true;
    this.changed();
  }

  replace(text: string) {
    this.bytes = null;
    this.isInEngine = false;
    this.release();
    for (const rule of this.parsed ?? []) rule.detach();
    this.chunks = [text];
    this.parsed = null;
    this.isStale = this.isLastChunkOpen = false;
    this.changed();
  }

  release() {
    if (this.wrapper !== null || !this.isDisposed) this.load();
    releaseCompiled(this.compiled);
  }

  compile(engine: any): number[] {
    if (this.isStale) {
      this.release();
      const texts = this.rules().map(rule => rule.text(true));
      this.chunks = [texts.join("\n")];
      this.isStale = false;
    }
    let ids = this.compiled.$get(engine);
    if (ids === undefined) {
      ids = [];
      if (this.bytes === null) this.load();
      else {
        ids.push(engine.createSheetFromUtf8(this.bytes, this.baseUrl, this.mediaText, this.scopeRoot()?.id ?? 0));
        this.bytes = null;
        this.isInEngine = true;
      }
      this.compiled.$set(engine, ids);
    }
    const closing = "}".repeat(this.prelude.split("{").length - 1);
    while (ids.length < this.chunks.length) {
      const text = this.chunks[ids.length];
      const root = text.includes("@scope") ? this.scopeRoot() : null;
      ids.push(engine.createSheet(this.prelude + text + closing, this.baseUrl, this.mediaText, root?.id ?? 0));
    }
    this.isLastChunkOpen = false;
    return ids;
  }

  scopeRoot(): N | null {
    const ownParent = this.parent;
    if (ownParent !== null) return ownParent.scopeRoot();
    const parent = this.owner?.parent ?? null;
    return parent !== null && parent.flags & flags.SHADOW_ROOT ? null : parent;
  }

  collect(engine: any, into: number[]) {
    if (this.disabled) return;
    for (const imported of this.imports) imported.collect(engine, into);
    into.push(...this.compile(engine));
  }

  dispose() {
    this.isDisposed = true;
    this.release();
    this.owner = null;
    for (const imported of this.imports) imported.dispose();
  }
}

let released: any[] = [];

function releaseCompiled(compiled: Map<any, number[]>) {
  for (const [engine, ids] of compiled) for (const id of ids) released.push(engine, id);
  compiled.clear();
}
const collectedSheets = new FinalizationRegistry(releaseCompiled);

function sheetsOf(scope: N): Sheet[] {
  const nodes: N[] = core.scopeOf(scope).styleNodes;
  return nodes
    .sort(core.compareOrder)
    .map(node => node.x.sheet)
    .filter(Boolean);
}

hooks.flushSheets = (doc: Doc) => {
  const scopes = Array.from<N>(doc.dirtyScopes);
  doc.dirtyScopes.clear();
  for (const scope of scopes) {
    if (scope.id === 0 || scope.doc !== doc) continue;
    const ids: number[] = [];
    for (const sheet of sheetsOf(scope)) sheet.collect(doc.engine, ids);
    for (const sheet of core.scopeOf(scope).adopted ?? []) {
      sheet.$impl.scopes.$add(scope);
      sheet.$impl.collect(doc.engine, ids);
    }
    if (scope === doc.node) for (const sheet of doc.page!.injectedSheets.values()) sheet.collect(doc.engine, ids);
    doc.engine.setSheets(scope.id, ids);
  }
  for (let i = 0; i < released.length; i += 2) released[i].releaseSheet(released[i + 1]);
  released = [];
};

class StyleSheet {
  declare $impl: Sheet;

  constructor() {
    if (new.target === StyleSheet) illegalConstructor();
  }
  get type() {
    void this.$impl.href;
    return "text/css";
  }
  get href() {
    return this.$impl.href;
  }
  get ownerNode() {
    return wrapOrNull(this.$impl.owner);
  }
  get parentStyleSheet() {
    return this.$impl.parent?.js ?? null;
  }
  get title() {
    return this.$impl.title || null;
  }
  get media() {
    const sheet: Sheet = this.$impl;
    return (sheet.media ??= mediaList(
      () => sheet.mediaText,
      text => setMedia(sheet, text),
    ));
  }
  set media(text) {
    setMedia(this.$impl, String(text));
  }
  get disabled() {
    return this.$impl.disabled;
  }
  set disabled(value) {
    this.$impl.disabled = !!value;
    this.$impl.changed();
  }
}

function setMedia(sheet: Sheet | null, text: string) {
  if (sheet === null) return;
  sheet.mediaText = text;
  sheet.release();
  sheet.changed();
}

class CSSStyleSheet extends StyleSheet {
  constructor(options: { media?: any; disabled?: boolean; baseURL?: string } | undefined = undefined) {
    super();
    const { doc } = core.realm.page;
    const sheet = new Sheet("", core.resolveUrl(doc, options?.baseURL ?? "") ?? doc.baseUrl);
    sheet.wrapper = this;
    sheet.isConstructed = true;
    collectedSheets.register(sheet, sheet.compiled);
    sheet.doc = doc;
    sheet.mediaText = String(options?.media ?? "");
    sheet.disabled = !!options?.disabled;
    this.$impl = sheet;
  }
  get ownerRule() {
    const sheet: Sheet = this.$impl;
    return sheet.parent?.rules().find(it => it.keyword === "import" && importedBy(it) === sheet)?.js ?? null;
  }
  get cssRules() {
    return ruleList(readable(this.$impl));
  }
  get rules() {
    return ruleList(readable(this.$impl));
  }
  insertRule(text: string, index = 0) {
    if ($argumentCount() < 1) core.tooFew(1);
    const sheet: Sheet = readable(this.$impl);
    const rules = sheet.rules();
    checkIndex((index >>>= 0), rules.length);
    const rule = parseRule(sheet, null, String(text));
    const isLast = index === rules.length && sheet.namespaces === "" && rank(rule) === 2;
    if (rule.keyword === "import" && sheet.isConstructed) {
      throw domError("SyntaxError", "Can't insert @import rules into a constructed stylesheet.");
    }
    insertRule(rules, rule, index);
    if (rule.keyword === "namespace") sheet.namespacesChanged();
    sheet.rulesChanged(isLast ? String(text) : null);
    if (rule.keyword === "import" || (isLayerStatement(rule) && sheet.imports.length > 0)) hooks.importsChanged(sheet);
    return index;
  }
  deleteRule(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    const sheet: Sheet = readable(this.$impl);
    checkIndex((index >>>= 0), sheet.rules().length - 1);
    if (rank(sheet.rules()[index]) === 1 && sheet.rules().some(it => rank(it) === 2)) {
      throw domError("InvalidStateError", "The @namespace rule cannot be deleted before the rules after it.");
    }
    const [rule] = sheet.rules().splice(index, 1);
    rule.detach();
    sheet.namespacesChanged();
    sheet.rulesChanged(null);
    if (rule.keyword === "import" || (isLayerStatement(rule) && sheet.imports.length > 0)) hooks.importsChanged(sheet);
  }
  addRule(selector = "undefined", style = "undefined", index = this.$impl.rules().length) {
    this.insertRule(`${selector} { ${style} }`, index);
    return -1;
  }
  removeRule(index = 0) {
    this.deleteRule(index);
  }
  replaceSync(text: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (!this.$impl.isConstructed) throw domError("NotAllowedError", "Can't replace a non-constructed CSSStyleSheet.");
    this.$impl.replace(String(text));
  }
  async replace(text: string) {
    this.replaceSync(text);
    return this;
  }
}

class StyleSheetList {
  constructor() {
    illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
}
iterable(StyleSheetList, false);
for (const ctor of [StyleSheet, CSSStyleSheet, StyleSheetList]) expose(ctor);

function checkAdoptable(scope: N, value: any) {
  const sheet: Sheet | undefined = value?.$impl;
  if (sheet?.isConstructed === undefined) throw new TypeError("Failed to convert value to 'CSSStyleSheet'.");
  if (!sheet.isConstructed) throw domError("NotAllowedError", "Can't adopt non-constructed stylesheets.");
  // Windows that have the same constructor cannot say which of them a sheet is for.
  const isAnyWindow = scope.doc.page !== null && scope.doc.mirror === sheet.doc!.mirror;
  if (sheet.doc !== scope.doc && !isAnyWindow)
    throw domError("NotAllowedError", "Sharing constructed stylesheets in multiple documents is not allowed");
}

function adoptedSheets(scope: N) {
  return (core.scopeOf(scope).adopted ??= observedSheets(scope));
}

function observedSheets(scope: N) {
  const isIndex = (key: string | symbol) => typeof key === "string" && String(+key >>> 0) === key;
  const truncate = (target: any[], length: number) => {
    for (const sheet of target.slice(length)) sheet.$impl.scopes.$delete(scope);
    target.length = length;
    core.dirtyScope(scope);
    return true;
  };
  const store = (target: any[], key: string, value: any) => {
    if (key === "length") {
      const length = value >>> 0;
      if (length !== +value) throw new RangeError("Invalid array length");
      return length <= target.length && truncate(target, length);
    }
    if (+key > target.length) return false;
    checkAdoptable(scope, value);
    if (+key < target.length) target[key].$impl.scopes.$delete(scope);
    core.dirtyScope(scope);
    $putByValDirect(target, +key, value);
    return true;
  };
  return new Proxy([], {
    __proto__: null,
    set: (target, key, value, receiver) =>
      key === "length" || isIndex(key)
        ? store(target, key as string, value)
        : Reflect.set(target, key, value, receiver),
    deleteProperty(target, key) {
      if (!isIndex(key)) return Reflect.deleteProperty(target, key);
      return +(key as string) === target.length - 1 && truncate(target, target.length - 1);
    },
    defineProperty(target, key, descriptor) {
      const own = { __proto__: null, ...descriptor } as PropertyDescriptor;
      if (key !== "length" && !isIndex(key)) return Reflect.defineProperty(target, key, own);
      const isLength = key === "length";
      if (
        "get" in own ||
        "set" in own ||
        own.configurable === isLength ||
        own.enumerable === isLength ||
        own.writable === false
      )
        return false;
      return !("value" in own) || store(target, key as string, own.value);
    },
    preventExtensions: () => false,
  } as ProxyHandler<any[]>);
}

const hasSheets = {
  get styleSheets() {
    const scope = (this as any).$impl;
    return (core.scopeOf(scope).styleSheets ??= makeList(StyleSheetList, {
      size: () => sheetsOf(scope).length,
      at: index => sheetsOf(scope)[index]?.js,
    }));
  },
  get adoptedStyleSheets() {
    return adoptedSheets((this as any).$impl);
  },
  set adoptedStyleSheets(sheets) {
    const list = adoptedSheets((this as any).$impl);
    const all = Array.from(sheets as any);
    for (const it of all) checkAdoptable((this as any).$impl, it);
    list.length = 0;
    list.push(...all);
  },
};

// ───────────────────────────── CSS ─────────────────────────────

function escape(value: string) {
  return String(value).replace(/^-$|\0|[\x01-\x1f\x7f]|(?<=^-?)\d|[^\w\-\u0080-￿]/g, character => {
    if (character === "\0") return "�";
    return /[\x01-\x1f\x7f\d]/.test(character) ? "\\" + character.charCodeAt(0).toString(16) + " " : "\\" + character;
  });
}

function checkRange(value: any) {
  if (value?.$impl?.startNode === undefined) throw new TypeError("The value is not of type 'AbstractRange'.");
  return value;
}

function valuesOf(collection: Highlight | HighlightRegistry): any[] {
  const values: unknown[] = [];
  collection.$impl.$forEach(it => values.push(it));
  return values;
}

function highlightsChanged() {
  for (const page of core.realm.pages) core.invalidate(page.doc);
}

/** What `setlike` and `maplike` have in common. */
function readsCollection(ctor: any, { entries, keys, values }: any, iterates: string) {
  const members = {
    get size() {
      return (this as any).$impl.$size;
    },
    entries() {
      return entries.$call((this as any).$impl);
    },
    keys() {
      return keys.$call((this as any).$impl);
    },
    values() {
      return values.$call((this as any).$impl);
    },
    forEach(callback: Function, self: unknown = undefined) {
      if (!$isCallable(callback)) throw new TypeError("The callback is not a function.");
      (this as any).$impl.$forEach((value, key) => (callback as any).$call(self, value, key, this));
    },
    clear() {
      (this as any).$impl.$clear();
      highlightsChanged();
    },
  };
  Object.defineProperties(ctor.prototype, Object.getOwnPropertyDescriptors(members));
  Object.defineProperty(ctor.prototype, Symbol.iterator, {
    value: members[iterates],
    writable: true,
    configurable: true,
  });
}

class Highlight {
  declare $impl: Set<any>;
  #priority = 0;
  #type = "highlight";
  constructor(...ranges: unknown[]) {
    this.$impl = new Set();
    for (const range of ranges) this.$impl.$add(checkRange(range));
  }
  add(range: unknown) {
    this.$impl.$add(checkRange(range));
    highlightsChanged();
    return this;
  }
  delete(range: unknown) {
    highlightsChanged();
    return this.$impl.$delete(checkRange(range));
  }
  has(range: unknown) {
    return this.$impl.$has(checkRange(range));
  }
  get priority() {
    return this.#priority;
  }
  set priority(value) {
    this.#priority = value | 0;
    highlightsChanged();
  }
  get type() {
    return this.#type;
  }
  set type(value) {
    core.brand(this);
    value = `${value}`;
    if (value === "highlight" || value === "spelling-error" || value === "grammar-error") this.#type = value;
  }
}
const ofRegistry = Symbol();
class HighlightRegistry {
  declare $impl: Map<string, Highlight>;
  constructor(key: unknown = undefined) {
    if (key !== ofRegistry) core.illegalConstructor();
    this.$impl = new Map();
  }
  set(name: string, highlight: Highlight) {
    if (typeof highlight?.priority !== "number" || highlight.$impl === undefined)
      throw new TypeError("The value is not of type 'Highlight'.");
    this.$impl.$set(`${name}`, highlight);
    highlightsChanged();
    return this;
  }
  delete(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    highlightsChanged();
    return this.$impl.$delete(`${name}`);
  }
  get(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.$get(`${name}`);
  }
  has(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.$has(`${name}`);
  }
  highlightsFromPoint(x: number, y: number, options: any = undefined) {
    if ($argumentCount() < 2) core.tooFew(2);
    if (!Number.isFinite((x = +x)) || !Number.isFinite((y = +y)))
      throw new TypeError("The provided float value is non-finite.");
    if (options != null && !$isObject(options)) throw new TypeError("The provided value is not a dictionary.");
    const roots = Array.from(options?.shadowRoots ?? [], it => core.unwrap(it, "highlightsFromPoint"));
    if (roots.some(it => !(it.flags & core.flags.SHADOW_ROOT)))
      throw new TypeError("A value is not of type 'ShadowRoot'.");
    const { doc } = core.realm.page;
    const hit = doc.nodes[core.sync(doc).hitTest(x, y)];
    const root = hit && core.rootOf(core.outOfControl(hit));
    if (!root || (root !== doc.node && !roots.includes(root))) return [];
    const isThere = ({ $impl: range }: any) => {
      const { startNode, startOffset, endNode, endOffset } = range;
      if (core.rootOf(core.outOfControl(startNode)) !== root || core.rootOf(startNode) !== core.rootOf(endNode))
        return false;
      if (startOffset > core.lengthOf(startNode) || endOffset > core.lengthOf(endNode)) return false;
      const rects = rangeRects(range);
      for (let i = 0; i < rects.length; i += 4) {
        if (x >= rects[i] && x < rects[i] + rects[i + 2] && y >= rects[i + 1] && y < rects[i + 1] + rects[i + 3])
          return true;
      }
      return false;
    };
    return valuesOf(this)
      .map(highlight => ({ highlight, ranges: valuesOf(highlight).filter(isThere) }))
      .filter(it => it.ranges.length > 0)
      .reverse()
      .sort((a, b) => b.highlight.priority - a.highlight.priority);
  }
}
readsCollection(Highlight, Set.prototype, "values");
readsCollection(HighlightRegistry, Map.prototype, "entries");
expose(Highlight);
expose(HighlightRegistry);

function flushHighlights(page: Page) {
  const registry: Map<string, Highlight> | undefined = page.highlights?.$impl;
  if (registry === undefined) return;
  const { doc } = page;
  const stale: Set<string> = page.paintedHighlights;
  const painted = new Set<string>();
  registry.$forEach((highlight, name) => {
    const points: number[] = [];
    for (const range of valuesOf(highlight)) {
      const { startNode, startOffset, endNode, endOffset } = range.$impl;
      if (startNode.doc !== doc || startNode.scope === null || endNode.scope === null) continue;
      if (startOffset > core.lengthOf(startNode) || endOffset > core.lengthOf(endNode)) continue;
      if (startNode.scope !== endNode.scope || comparePoints(startNode, startOffset, endNode, endOffset) >= 0) continue;
      points.push(
        pointId(startNode),
        pointOffset(startNode, startOffset),
        pointId(endNode),
        pointOffset(endNode, endOffset),
      );
    }
    doc.engine.setHighlight(name, highlight.priority | 0, points);
    stale.$delete(name);
    painted.$add(name);
  });
  stale.$forEach(name => doc.engine.setHighlight(name, 0, []));
  page.paintedHighlights = painted;
}

const units =
  splitTokens(`Hz Q cap ch cm cqb cqh cqi cqmax cqmin cqw deg dpcm dpi dppx dvb dvh dvi dvmax dvmin dvw em ex fr grad
  ic in kHz lh lvb lvh lvi lvmax lvmin lvw mm ms number pc percent pt px rad rcap rch rem rex ric rlh s svb svh svi svmax svmin
  svw turn vb vh vi vmax vmin vw x`);

function createCss(page: Page) {
  const registered = new Set<string>();
  const css = {
    escape(ident: string) {
      if ($argumentCount() < 1) core.tooFew(1);
      return escape(ident);
    },
    supports(first: string, value: string | undefined = undefined) {
      if ($argumentCount() < 1) core.tooFew(1);
      if (arguments.length > 1) return engine.supportsDeclaration(String(first), String(value));
      return engine.supportsCondition(String(first)) || engine.supportsCondition(`(${first})`);
    },
    registerProperty(definition: any) {
      let { inherits, initialValue, name, syntax = "*" } = definition ?? {};
      if (inherits === undefined || name === undefined) throw new TypeError("Required member is undefined.");
      name = `${name}`;
      if (!name.startsWith("--") || name.length < 3)
        throw domError("SyntaxError", "Custom property names must start with '--'.");
      if (registered.$has(name)) throw domError("InvalidModificationError", "The name has already been registered.");
      if (
        !page.doc.engine.registerProperty(
          name,
          `${syntax}`,
          !!inherits,
          initialValue === undefined ? null : `${initialValue}`,
        )
      ) {
        throw domError("SyntaxError", "The syntax or the initial value is not valid.");
      }
      registered.$add(name);
      core.invalidate(page.doc);
    },
    get highlights() {
      page.paintedHighlights ??= new Set();
      return (page.highlights ??= new HighlightRegistry(ofRegistry));
    },
  };
  for (const unit of units) css[unit] = { [unit]: (value: number) => typed().unit(value, unit) }[unit];
  return Object.defineProperty(css, Symbol.toStringTag, { value: "CSS", configurable: true });
}

export default {
  Sheet,
  canonicalValue,
  computedStyle,
  createCss,
  escape,
  flushHighlights,
  hasSheets,
  longhandsOf: (name: string) => property(name).longhands,
  parseFont,
  propertyNamed,
  setMedia,
  styleMap,
  styleOf,
};
