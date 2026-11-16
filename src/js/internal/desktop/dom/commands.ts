// https://w3c.github.io/editing/docs/execCommand/
const core = require("internal/desktop/dom/core");
const ranges = require("internal/desktop/dom/range");
const engine = require("internal/desktop/dom/engine");
const { styleOf } = require("internal/desktop/dom/cssom");

const { ELEMENT, TEXT, COMMENT, DOCUMENT, DOCTYPE, FRAGMENT, HTML, SVG, MATHML } = core;
const {
  asciiLower,
  childArray,
  contains,
  following,
  followingSkip,
  getAttr,
  hasAttr,
  hooks,
  indexOf,
  isHtml,
  lengthOf,
} = core;
const { comparePoints, rangeOf, selectionOf } = ranges;

type N = $Dom.N;
type Doc = $Dom.Doc;
type R = $Dom.Range;
type Maybe = N | null;
type Point = [node: N, offset: number];
type Value = string | null;
type Test = (node: N) => boolean;

/** What outlasts a command. */
class State {
  usesCss = false;
  separator = "div";
  /** For what is typed next, for as long as the selection is at `where`. */
  overrides = new Map<string, boolean | string>();
  where: unknown[] = [];
}
const states = new WeakMap<Doc, State>();

let doc: Doc;
let state: State;
let active: R;
/** Kept as `active` is when a node moves. */
let extra: R | null = null;
let steps = 0;
const exhausted = {};
const computed = new Map<string, string>();

const names = (text: string) => new Set<string>(core.splitTokens(text));
const isIn = (node: Maybe | undefined, set: Set<string>) =>
  node != null && node.type === ELEMENT && node.ns === HTML && set.$has(node.name);
const lists = names("ol ul");
const items = names("li dt dd");
const definitions = names("dt dd");
const cells = names("td th");
const tableParts = names("thead tbody tfoot tr th td");
const rowHolders = names("colgroup table tbody tfoot thead tr");
const onlyInTables = names("body caption col colgroup frame frameset head html tbody td tfoot th thead tr");
const rawText = names("script style plaintext xmp");
const replaced = names("img input textarea select video audio canvas iframe object embed meter progress");
const notInParagraphs = names(`address article aside blockquote caption center col colgroup dd details dir div dl dt
  fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr li listing menu nav ol p plaintext pre
  section summary table tbody td tfoot th thead tr ul xmp`);
const inlineContainers = names(`a abbr b bdi bdo cite code dfn em h1 h2 h3 h4 h5 h6 i kbd mark p pre q rp rt ruby s samp
  small span strong sub sup u var acronym listing strike xmp big blink font marquee nobr tt`);
const modifiable = names("a b em font i s span strike strong sub sup u");
const formatting = names(`abbr acronym b bdi bdo big blink cite code dfn em font i ins kbd mark nobr q s samp small span
  strike strong sub sup tt u var`);
const lineContainers = names("address div h1 h2 h3 h4 h5 h6 listing p pre xmp");
const preformatted = names("listing pre xmp");
const voids = names("area base br col embed hr link meta param source track wbr");
const formattableBlocks = names("address dd div dt h1 h2 h3 h4 h5 h6 p pre");
const allowedIn: Record<string, Set<string> | undefined> = {
  __proto__: null as any,
  colgroup: names("col"),
  table: names("caption col colgroup tbody td tfoot th thead tr"),
  tbody: names("td th tr"),
  thead: names("td th tr"),
  tfoot: names("td th tr"),
  tr: cells,
  dl: definitions,
  dir: names("dir li ol ul"),
  ol: names("dir li ol ul"),
  ul: names("dir li ol ul"),
  hgroup: names("h1 h2 h3 h4 h5 h6"),
};
const isHeading = (name: string) => /^h[1-6]$/.test(name);

// ───────────────────────────── the tree ─────────────────────────────

function css(node: N, property: string): string {
  if (++steps > 3_000_000) throw exhausted;
  const key = node.id + property;
  let value = computed.$get(key);
  if (value === undefined)
    computed.$set(key, (value = node.id === 0 ? "" : core.sync(doc).computedStyle(node.id, "", property)));
  return value!;
}

const create = (name: string): N => core.createPlainElement(doc, name, HTML);
const child = (node: N, index: number): Maybe => (index < 0 ? null : core.childAt(node, index));
const children = (node: N): N[] => childArray(node).slice();
const attributeCount = (node: N) => (node.attrs?.length ?? 0) / 2;
const inlineStyle = (node: N, property: string): string =>
  hasAttr(node, "style") ? styleOf(node).getPropertyValue(property) : "";

function insert(node: N, parent: N, before: Maybe) {
  if (++steps > 3_000_000 || contains(node, parent)) throw exhausted;
  if (node.parent !== null) core.remove(node);
  core.insert(node, parent, before);
  computed.$clear();
}

function remove(node: N) {
  core.remove(node);
  computed.$clear();
}

function setAttribute(node: N, name: string, value: Value) {
  if (value === null) core.removeAttr(node, name);
  else core.setAttr(node, name, value);
  computed.$clear();
}

function setStyle(node: N, property: string, value: string) {
  if (value === "" && !hasAttr(node, "style")) return;
  styleOf(node).setProperty(property, value);
  if (getAttr(node, "style") === "") core.removeAttr(node, "style");
  computed.$clear();
}

/** With the longhands of `text-decoration` as one. */
function styledProperties(node: N): string[] {
  if (!hasAttr(node, "style")) return [];
  return [
    ...new Set(Array.from(styleOf(node) as any as ArrayLike<string>, it => it.replace(/^(text-decoration)-.*/, "$1"))),
  ];
}

function addBreak(parent: N, before: Maybe = null): N {
  const made = create("br");
  insert(made, parent, before);
  return made;
}

function insertAtCaret(node: N) {
  ranges.insertNode(active, node);
  computed.$clear();
}

function select(node: N, offset: number, endNode = node, endOffset = offset) {
  active.set(node, offset, endNode, endOffset);
}
const collapseBefore = (node: N) => select(node.parent!, indexOf(node));
const collapseAfter = (node: N) => select(node.parent!, indexOf(node) + 1);
function collapse(toStart: boolean) {
  if (toStart) select(active.startNode, active.startOffset);
  else select(active.endNode, active.endOffset);
}

function ancestors(node: N): N[] {
  const list: N[] = [];
  for (let at = node.parent; at !== null; at = at.parent) list.push(at);
  return list;
}

function descendants(root: N): N[] {
  const list: N[] = [];
  for (let at = root.first; at !== null; at = following(at, root)) list.push(at);
  return list;
}

function isContained(node: N, range: R): boolean {
  return (
    comparePoints(node, 0, range.startNode, range.startOffset) > 0 &&
    comparePoints(node, lengthOf(node), range.endNode, range.endOffset) < 0
  );
}

function collect(from: Maybe, stop: Maybe, test: Test, outermost: boolean): N[] {
  const list: N[] = [];
  if (from !== null && stop !== null && core.compareOrder(from, stop) > 0) return list;
  while (from !== null && from !== stop) {
    const passes = test(from);
    if (passes) list.push(from);
    from = passes && outermost && !contains(from, stop) ? followingSkip(from, null) : following(from, null);
  }
  return list;
}

function contained(range: R, test: Test, outermost = true): N[] {
  const from = ranges.nodeAfter(range.startNode, range.startOffset);
  return collect(
    from,
    ranges.nodeAfter(range.endNode, range.endOffset),
    it => isContained(it, range) && test(it),
    outermost,
  );
}

function isEffectivelyContained(node: N, range: R): boolean {
  const { startNode, startOffset, endNode, endOffset } = range;
  if (range.collapsed) return false;
  if (isContained(node, range)) return true;
  if (node.type === TEXT)
    return (node === startNode && startOffset !== node.data.length) || (node === endNode && endOffset !== 0);
  return (
    node.first !== null &&
    (startNode.type !== TEXT || startOffset === 0 || !contains(node, startNode)) &&
    (endNode.type !== TEXT || endOffset === endNode.data.length || !contains(node, endNode)) &&
    childArray(node).every(it => isEffectivelyContained(it, range))
  );
}

function selected(test: Test): N[] {
  let from = active.startNode;
  while (from.parent !== null && isEffectivelyContained(from.parent, active)) from = from.parent;
  return collect(
    from,
    followingSkip(active.endNode, null),
    it => isEffectivelyContained(it, active) && test(it),
    false,
  );
}

function isBlock(node: Maybe): boolean {
  if (node === null) return false;
  if (node.type !== ELEMENT) return node.type === DOCUMENT || node.type === FRAGMENT;
  return !/^(?:inline|none|contents|ruby|math|-webkit-inline|$)/.test(css(node, "display"));
}
const isInline = (node: Maybe) => node !== null && !isBlock(node);
const isBreak = (node: Maybe | undefined) => isHtml(node ?? null, "br");
const isAtomic = (node: N) =>
  isIn(node, replaced) || (node.type === ELEMENT && (node.ns === SVG || /^inline-/.test(css(node, "display"))));

function editability(node: N): string {
  const value = node.type === ELEMENT && node.ns === HTML ? getAttr(node, "contenteditable") : null;
  return value === null ? "inherit" : value === "" ? "true" : asciiLower(value);
}

function isHost(node: Maybe): boolean {
  if (node === null || node.type !== ELEMENT || node.ns !== HTML) return false;
  if (/^(?:true|plaintext-only)$/.test(editability(node)) || (doc.designMode && node.parent === doc.node)) return true;
  return node.name === "body" && editability(node) !== "false" && isHtml(node.parent, "html") && isHost(node.parent);
}

function hostOf(node: Maybe): Maybe {
  for (; node !== null; node = node.parent) {
    if (isHost(node)) return node;
    if (node.type !== ELEMENT) {
      if (node.parent?.ns !== HTML) return null;
    } else if (node.ns === HTML) {
      if (editability(node) === "false") return null;
    } else if (node.name !== (node.ns === SVG ? "svg" : node.ns === MATHML ? "math" : "")) return null;
  }
  return null;
}

/** The `<head>` of an editable `<html>` is not. */
function isEditable(node: Maybe | undefined): boolean {
  if (isHtml(node ?? null, "head")) return false;
  const host = hostOf(node ?? null);
  return host !== null && host !== node;
}

function shareHost(a: Maybe, b: Maybe): boolean {
  const host = hostOf(a);
  return host !== null && host === hostOf(b);
}

const isPlain = (node: N) => editability(hostOf(node) ?? node) === "plaintext-only";
const collapsing = (text: N) => (text.parent?.type === ELEMENT ? css(text.parent, "white-space-collapse") : "");
const keepsSpaces = (text: N) => /^(?:preserve|preserve-spaces|break-spaces)$/.test(collapsing(text));
const keepsBreaks = (text: N) => /^(?:preserve|preserve-breaks|break-spaces)$/.test(collapsing(text));

function isWhitespace(node: N): boolean {
  if (node.type !== TEXT) return false;
  if (node.data === "") return true;
  if (!/^[\t\n\r ]+$/.test(node.data) || keepsSpaces(node)) return false;
  return !keepsBreaks(node) || !node.data.includes("\n");
}

function isHidden(node: Maybe): boolean {
  for (; node !== null; node = node.parent)
    if (node.type === ELEMENT && /^(?:none|)$/.test(css(node, "display"))) return true;
  return false;
}

const enum Beside {
  Edge,
  Break,
  Content,
}

/** What is next to `node` on its line. */
function beside(node: N, isForward: boolean): Beside {
  for (let at = node; ;) {
    let next = isForward ? at.next : at.prev;
    if (next === null) {
      if (at.parent === null || isBlock((at = at.parent)) || isAtomic(at) || isHost(at)) return Beside.Edge;
      continue;
    }
    while (true) {
      at = next;
      if (at.type === TEXT) {
        if (isWhitespace(at)) break;
        if (!keepsBreaks(at)) return Beside.Content;
        const spaces = keepsSpaces(at) ? "" : "[ \\t]*";
        return new RegExp(isForward ? `^${spaces}\\n` : `\\n${spaces}$`).test(at.data) ? Beside.Break : Beside.Content;
      }
      if (at.type !== ELEMENT || css(at, "display") === "none") break;
      if (isBreak(at)) return Beside.Break;
      if (isBlock(at)) {
        if (/^(?:absolute|fixed)$/.test(css(at, "position")) || css(at, "float") !== "none") break;
        return Beside.Edge;
      }
      if (isAtomic(at)) return Beside.Content;
      if ((next = isForward ? at.first : at.last) === null) break;
    }
  }
}

/** The line that it begins has nothing on it. */
const isCollapsedBreak = (node: Maybe) => isBreak(node) && beside(node!, true) === Beside.Edge;

function isExtraneousBreak(node: Maybe): boolean {
  if (!isBreak(node) || (isHtml(node!.parent, "li") && node!.prev === null && node!.next === null)) return false;
  return isCollapsedBreak(node) && beside(node!, false) === Beside.Content;
}

function isCollapsedWhitespace(node: N): boolean {
  if (!isWhitespace(node)) return false;
  return (
    node.data === "" ||
    node.parent === null ||
    beside(node, false) !== Beside.Content ||
    beside(node, true) !== Beside.Content
  );
}

function isShown(node: N): boolean {
  if (node.type === TEXT) return !isCollapsedWhitespace(node);
  if (node.type !== ELEMENT) return isBlock(node);
  if (css(node, "display") === "none") return false;
  if (isBreak(node)) return !isExtraneousBreak(node);
  return isBlock(node) || isIn(node, replaced) || node.ns === SVG || childArray(node).some(isShown);
}
const isVisible = (node: Maybe | undefined) => node != null && !isHidden(node) && isShown(node);
const isInvisible = (node: Maybe) => node !== null && !isVisible(node);
const isRemovable = (node: Maybe) => isEditable(node) && (isInvisible(node) || isEmptyBlock(node!));

function isEmptyBlock(node: N): boolean {
  return isIn(node, lineContainers) && childArray(node).every(isRemovable) && css(node, "height") === "0px";
}

/** It only keeps its block from having no height. */
function isBlockProp(node: Maybe): boolean {
  if (node === null) return false;
  if (isBreak(node)) return isCollapsedBreak(node) && !isExtraneousBreak(node);
  if (node.type !== ELEMENT || isBlock(node)) return false;
  const visible = childArray(node).filter(isVisible);
  return visible.length > 0 && visible.every(isBlockProp);
}

function keepOpen(block: N) {
  if (!childArray(block).some(isVisible)) addBreak(block);
}

/** -1 for the end. */
function move(node: N, parent: N, index: number) {
  if (index < 0) index = lengthOf(parent);
  const oldParent = node.parent;
  const oldIndex = indexOf(node);
  const adjust = (at: N, offset: number): Point => {
    if (at === parent && offset > index) offset++;
    if (at === oldParent && (offset === oldIndex || offset === oldIndex + 1))
      [at, offset] = [parent, offset + index - oldIndex];
    if (at === oldParent && offset > oldIndex + 1) offset--;
    return [at, offset];
  };
  const kept = (extra === null ? [active] : [active, extra]).map(it => ({
    range: it,
    start: adjust(it.startNode, it.startOffset),
    end: adjust(it.endNode, it.endOffset),
  }));
  let before = child(parent, index);
  if (before === node) before = node.next;
  insert(node, parent, before);
  for (const { range, start, end } of kept) {
    range.set(start[0], Math.min(start[1], lengthOf(start[0])), end[0], Math.min(end[1], lengthOf(end[0])));
    if (comparePoints(range.startNode, range.startOffset, range.endNode, range.endOffset) > 0) {
      range.set(range.endNode, range.endOffset, range.endNode, range.endOffset);
    }
  }
}

function moveChildren(from: N, to: N) {
  while (from.first !== null) move(from.first, to, -1);
}

function unwrap(element: N) {
  while (element.first !== null) move(element.first, element.parent!, indexOf(element));
  remove(element);
}

function copyAttributes(from: N, to: N) {
  for (let i = 0; i < attributeCount(from); i++)
    core.setAttr(to, from.attrs![i * 2], getAttr(from, from.attrs![i * 2])!);
}

function rename(element: N, name: string): N {
  if (isHtml(element, name) || element.parent === null) return element;
  const made = create(name);
  copyAttributes(element, made);
  insert(made, element.parent, element);
  moveChildren(element, made);
  remove(element);
  return made;
}

function lastExtraneousBreak(from: N, stop: Maybe): Maybe {
  let at: Maybe = from;
  while (at.last !== null) at = at.last;
  while (at !== stop && isInvisible(at) && !isExtraneousBreak(at)) at = core.preceding(at!, null);
  return isEditable(at) && isExtraneousBreak(at) ? at : null;
}

function trimBreakBefore(node: N) {
  const found = node.prev && lastExtraneousBreak(node.prev, node.parent);
  if (found !== null) remove(found);
}

function trimBreakAtEnd(node: N) {
  let found = lastExtraneousBreak(node, node);
  if (found === null) return;
  while (isRemovable(found.parent)) found = found.parent!;
  remove(found);
}

const never = () => false;

function wrap(nodes: N[], isSuitable: Test, makeParent: () => Maybe = () => null): Maybe {
  if ((nodes.every(isInvisible) && !nodes.some(isBreak)) || nodes[0].parent === null) return null;
  const last = () => nodes.at(-1)!;
  if (isInline(last()) && !isBreak(last()) && isBreak(last().next)) nodes.push(last().next!);
  while (isInvisible(nodes[0].prev)) nodes.unshift(nodes[0].prev!);
  while (isInvisible(last().next)) nodes.push(last().next!);
  const fits = (node: Maybe) => isEditable(node) && isSuitable(node!);
  const parent = fits(nodes[0].prev) ? nodes[0].prev : fits(last().next) ? last().next : makeParent();
  if (parent === null) return null;
  if (parent.parent === null) {
    insert(parent, nodes[0].parent!, nodes[0]);
    const index = indexOf(parent);
    active.map((node, offset) => (node === parent.parent && offset === index ? [node, offset + 1] : undefined));
  }
  const oldParent = nodes[0].parent!;
  const [own, added] = [childArray(parent).filter(isVisible), nodes.filter(isVisible)];
  if (core.compareOrder(parent, nodes[0]) < 0) {
    if (isBlock(parent) && isInline(own.at(-1) ?? null) && isInline(added[0] ?? null) && !isBreak(parent.last))
      addBreak(parent);
    for (const node of nodes) move(node, parent, -1);
  } else {
    if (isBlock(parent) && isInline(own[0] ?? null) && isInline(added.at(-1) ?? null) && !isBreak(last())) {
      addBreak(parent, parent.first);
    }
    for (const node of nodes.toReversed()) move(node, parent, 0);
  }
  if (isEditable(oldParent) && oldParent.first === null) remove(oldParent);
  const { next } = parent;
  if (fits(next)) {
    if (isBlock(parent) && isInline(parent.last) && isInline(next!.first) && !isBreak(parent.last)) addBreak(parent);
    moveChildren(next!, parent);
    remove(next!);
  }
  trimBreakBefore(parent);
  trimBreakAtEnd(parent);
  return parent;
}

function isAllowedChild(node: N | string, parent: N | string): boolean {
  const parentName =
    typeof parent === "string" ? parent : parent.type === ELEMENT && parent.ns === HTML ? parent.name : "";
  if (typeof node !== "string") {
    if (node.type === TEXT) return !rowHolders.$has(parentName) || /^[ \t\n\f\r]*$/.test(node.data);
    if (rawText.$has(parentName) || node.type === DOCUMENT || node.type === FRAGMENT || node.type === DOCTYPE)
      return false;
    if (node.type !== ELEMENT || node.ns !== HTML) return true;
    node = node.name;
  }
  if (rawText.$has(parentName)) return false;
  if (typeof parent !== "string") {
    if (parentName === "") return parent.type === ELEMENT || parent.type === FRAGMENT;
    for (let at: Maybe = parent; at !== null; at = at.parent) {
      if (at.type !== ELEMENT || at.ns !== HTML) continue;
      if (node === "a" && at.name === "a") return false;
      if (notInParagraphs.$has(node) && inlineContainers.$has(at.name)) return false;
      if (isHeading(node) && isHeading(at.name)) return false;
    }
  }
  if (allowedIn[parentName] !== undefined) return allowedIn[parentName].$has(node);
  if (onlyInTables.$has(node) || items.$has(node)) return false;
  if ((node === "a" || node === "nobr") && node === parentName) return false;
  return !(inlineContainers.$has(parentName) && notInParagraphs.$has(node));
}

// ───────────────────────────── inline formatting ─────────────────────────────

type Command = {
  run(value: string): boolean;
  indeterminate?(): boolean;
  state?(): boolean;
  value?(): string;
  property?: string;
  /** The values with which it is on. */
  activeValues?: string[];
  normalize?(value: string): unknown;
};
const commands: Record<string, Command> = { __proto__: null as any };

const sizes = ["x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large"];
const pixelSizes = [10, 13, 16, 18, 24, 32, 48];
const toggles = ["bold", "italic", "strikethrough", "subscript", "superscript", "underline"];
const valued = ["fontname", "fontsize", "forecolor", "hilitecolor"];
const recorded = [
  "subscript",
  "bold",
  "fontname",
  "fontsize",
  "forecolor",
  "hilitecolor",
  "italic",
  "strikethrough",
  "underline",
];
const fontAttributes: Record<string, string | undefined> = {
  __proto__: null as any,
  forecolor: "color",
  fontname: "face",
  fontsize: "size",
};
const decorations: Record<string, string | undefined> = {
  __proto__: null as any,
  strikethrough: "line-through",
  underline: "underline",
};
const isLink = (command: string) => command === "createlink" || command === "unlink";
const isScript = (command: string) => command === "subscript" || command === "superscript";
const isBackground = (command: string) => command === "backcolor" || command === "hilitecolor";
const isAnchor = (node: Maybe) => isHtml(node, "a") && hasAttr(node!, "href");

function overrides(): Map<string, boolean | string> {
  const where = [active.startNode, active.startOffset, active.endNode, active.endOffset];
  if (where.some((it, index) => it !== state.where[index])) {
    state.overrides.$clear();
    state.where = where;
  }
  return state.overrides;
}
const overrideKey = (command: string) => (command === "backcolor" ? "hilitecolor" : command);

function isModifiable(node: Maybe): boolean {
  if (!isIn(node, modifiable)) return false;
  const allowed =
    node!.name === "font" ? /^(?:style|color|face|size)$/ : node!.name === "a" ? /^(?:style|href)$/ : /^style$/;
  return (node!.attrs ?? []).every((it, index) => index % 2 === 1 || allowed.test(it));
}

function isSimplyModifiable(node: N): boolean {
  if (!isModifiable(node) || attributeCount(node) > 1) return false;
  const properties = styledProperties(node);
  if (properties.length !== 1) return properties.length === 0;
  const { name } = node;
  if (properties[0] === "text-decoration") {
    return (
      /^(?:a|font|s|span|strike|u)$/.test(name) && /^(?:line-through|underline|overline|none)$/.test(decorationOf(node))
    );
  }
  if (name === "b" || name === "strong") return properties[0] === "font-weight";
  if (name === "i" || name === "em") return properties[0] === "font-style";
  return name === "a" || name === "font" || name === "span";
}

const decorationOf = (node: N) => inlineStyle(node, "text-decoration") || inlineStyle(node, "text-decoration-line");
const isFormattable = (node: N) =>
  (node.type === TEXT || isBreak(node) || isHtml(node, "img")) && isEditable(node) && isVisible(node);

function areEquivalent(command: string, a: Value, b: Value): boolean {
  if (a === b) return true;
  const { normalize } = commands[command];
  return a !== null && b !== null && normalize !== undefined && normalize(a) === normalize(b);
}

function areLooselyEquivalent(command: string, a: Value, b: Value): boolean {
  if (areEquivalent(command, a, b)) return true;
  const pixels = (keyword: Value) => pixelSizes[sizes.indexOf(keyword!)] + "px";
  return command === "fontsize" && (a === pixels(b) || b === pixels(a));
}

function effectiveValue(node: N, command: string): Value {
  let at: Maybe = node.type === ELEMENT ? node : node.parent;
  if (at === null || at.type !== ELEMENT) return null;
  if (isLink(command)) {
    while (at !== null && !isAnchor(at)) at = at.parent;
    return at && getAttr(at, "href");
  }
  if (isBackground(command)) {
    while (css(at, "background-color") === "rgba(0, 0, 0, 0)" && at.parent?.type === ELEMENT) at = at.parent;
    return css(at, "background-color");
  }
  if (isScript(command)) {
    let [isSub, isSuper] = [false, false];
    for (; isInline(at); at = at!.parent) {
      isSub ||= isHtml(at, "sub");
      isSuper ||= isHtml(at, "sup");
    }
    return isSub && isSuper ? "mixed" : isSub ? "subscript" : isSuper ? "superscript" : null;
  }
  const line = decorations[command];
  if (line === undefined) return css(at, commands[command].property!);
  for (; at?.type === ELEMENT; at = at.parent) if (css(at, "text-decoration-line").includes(line)) return line;
  return null;
}

function specifiedValue(element: N, command: string): Value {
  if (isBackground(command) && css(element, "display") !== "inline") return null;
  if (isLink(command)) return isAnchor(element) ? getAttr(element, "href") : null;
  if (isScript(command)) return isHtml(element, "sup") ? "superscript" : isHtml(element, "sub") ? "subscript" : null;
  const name = element.ns === HTML ? element.name : "";
  const line = decorations[command];
  if (line !== undefined) {
    const declared = decorationOf(element);
    if (declared !== "") return declared.includes(line) ? line : null;
    return (line === "underline" ? name === "u" : name === "s" || name === "strike") ? line : null;
  }
  const declared = inlineStyle(element, commands[command].property!);
  if (declared !== "") return declared;
  const hint =
    name === "font" && fontAttributes[command] !== undefined ? getAttr(element, fontAttributes[command]) : null;
  if (hint !== null)
    return command === "fontsize" ? (sizes[Math.min(Math.max(parseInt(hint), 1), 7) - 1] ?? null) : hint;
  if (command === "bold" && (name === "b" || name === "strong")) return "bold";
  return command === "italic" && (name === "i" || name === "em") ? "italic" : null;
}

function setsOnly(node: N, command: string, value: Value): boolean {
  return isSimplyModifiable(node) && areEquivalent(command, specifiedValue(node, command), value);
}
const has = (node: N, command: string, value: Value) =>
  areLooselyEquivalent(command, effectiveValue(node, command), value);

function reorderModifiableDescendants(node: Maybe, command: string, value: Value) {
  if (node === null) return;
  let candidate = node;
  while (
    isModifiable(candidate) &&
    candidate.first === candidate.last &&
    isModifiable(candidate.first) &&
    !setsOnly(candidate, command, value)
  ) {
    candidate = candidate.first!;
  }
  if (candidate === node || !setsOnly(candidate, command, value) || !has(candidate, command, value)) return;
  while (candidate.first !== null) move(candidate.first, candidate.parent!, indexOf(candidate));
  insert(candidate, node.parent!, node.next);
  move(node, candidate, -1);
}

function nearestSpecifiedValue(node: N, command: string): Value {
  for (let at = node.type === ELEMENT ? node : node.parent; at?.type === ELEMENT; at = at.parent) {
    const value = specifiedValue(at, command);
    if (value !== null) return value;
  }
  return null;
}

/** `nodes` look the same after `change` has moved them. */
function keepingValues(nodes: N[], change: () => void) {
  const values = nodes.flatMap(node =>
    recorded.map(command => ({ node, command, value: nearestSpecifiedValue(node, command) })),
  );
  change();
  for (const { node, command, value } of values) {
    const now = nearestSpecifiedValue(node, command);
    if (value === null && now !== null) pushDownValues(node, command, null);
    else if (!areEquivalent(command, now, value)) forceValue(node, command, value);
  }
}

function clearValue(element: N, command: string) {
  if (!isEditable(element) || specifiedValue(element, command) === null) return;
  if (isSimplyModifiable(element)) return unwrap(element);
  const line = decorations[command];
  if (line !== undefined && decorationOf(element).includes(line)) {
    const property = inlineStyle(element, "text-decoration") === "" ? "text-decoration-line" : "text-decoration";
    setStyle(element, property, decorationOf(element).replace(line, "").trim());
  }
  if (commands[command].property !== undefined) setStyle(element, commands[command].property, "");
  if (isHtml(element, "font") && fontAttributes[command] !== undefined)
    setAttribute(element, fontAttributes[command], null);
  if (isHtml(element, "a") && isLink(command)) setAttribute(element, "href", null);
  if (specifiedValue(element, command) !== null) rename(element, "span");
}

function overridesValue(node: N, command: string, value: Value): boolean {
  const own = node.type === ELEMENT ? specifiedValue(node, command) : null;
  return own !== null && !areEquivalent(command, value, own);
}

function pushDownValues(node: N, command: string, value: Value) {
  if (node.parent?.type !== ELEMENT || has(node, command, value)) return;
  const path: N[] = [];
  for (let at = node.parent; isEditable(at) && !has(at, command, value); at = at.parent!) path.push(at);
  if (path.length === 0) return;
  let propagated = specifiedValue(path.at(-1)!, command);
  if (value !== null && (propagated === null || !has(path.at(-1)!.parent!, command, value))) return;
  let model: Maybe = null;
  while (path.length > 0) {
    const ancestor = path.pop()!;
    if (specifiedValue(ancestor, command) !== null) model = attributeCount(ancestor) === 0 ? ancestor : null;
    propagated = specifiedValue(ancestor, command) ?? propagated;
    const inside = children(ancestor);
    clearValue(ancestor, command);
    for (const it of inside) {
      if (it !== node && it !== path.at(-1) && !overridesValue(it, command, propagated))
        forceValue(it, command, propagated, model);
    }
  }
}

function forceOnChildren(node: N, command: string, value: string) {
  for (const it of children(node).filter(it => !overridesValue(it, command, value))) forceValue(it, command, value);
}

function elementFor(command: string, value: string): N {
  const font = (text: string) => {
    const made = create("font");
    core.setAttr(made, fontAttributes[command]!, text);
    return made;
  };
  if (isLink(command)) {
    const made = create("a");
    core.setAttr(made, "href", value);
    return made;
  }
  if (isScript(command)) return create(value === "subscript" ? "sub" : value === "superscript" ? "sup" : "span");
  if (command === "fontsize" && sizes.includes(value) && !state.usesCss) return font(String(sizes.indexOf(value) + 1));
  if (state.usesCss) return create("span");
  if (command === "bold" && areEquivalent(command, value, "bold")) return create("b");
  if (command === "italic" && value === "italic") return create("i");
  if (command === "strikethrough") return create("strike");
  if (command === "underline") return create("u");
  if (command === "forecolor" && simpleColor(value) !== null) return font(simpleColor(value)!);
  return command === "fontname" ? font(value) : create("span");
}

/** `model` is an element that has the value. */
function forceValue(node: N, command: string, value: Value, model: Maybe = null) {
  if (node.parent === null || value === null) return;
  const parent = model === null ? elementFor(command, value) : core.clone(model, doc, false);
  if (isAllowedChild(node, "span")) {
    reorderModifiableDescendants(node.prev, command, value);
    reorderModifiableDescendants(node.next, command, value);
    wrap([node], it => it.name === parent.name && setsOnly(it, command, value) && has(it, command, value));
  }
  if (isInvisible(node) || has(node, command, value)) return;
  if (!isAllowedChild(node, "span")) return forceOnChildren(node, command, value);
  if (isLink(command)) for (const ancestor of ancestors(node)) if (isHtml(ancestor, "a")) rename(ancestor, "span");
  insert(parent, node.parent!, node);
  const property = decorations[command] !== undefined ? "text-decoration-line" : commands[command].property;
  if (property !== undefined && !has(parent, command, value)) setStyle(parent, property, value);
  move(node, parent, -1);
  if (node.type === ELEMENT && !areEquivalent(command, effectiveValue(node, command), value)) {
    unwrap(parent);
    forceOnChildren(node, command, value);
  }
}

function splitTextAtEnds() {
  const isInside = (node: N, offset: number) =>
    node.type === TEXT && offset > 0 && offset < node.data.length && isEditable(node);
  if (isInside(active.startNode, active.startOffset)) {
    const rest = core.splitText(active.startNode, active.startOffset);
    select(rest, 0, active.endNode, active.endOffset);
  }
  if (isInside(active.endNode, active.endOffset)) core.splitText(active.endNode, active.endOffset);
}

/** If that takes no other kind of element. */
function setOwnValue(element: N, command: string, value: string) {
  const model = elementFor(command, value);
  if (model.name === "font" && isHtml(element, "font")) setAttribute(element, model.attrs![0], model.attrs![1]);
  if (model.name !== "span" || isScript(command)) return;
  if (decorations[command] === undefined) setStyle(element, commands[command].property!, value);
  else if (isHtml(element, "span")) setStyle(element, "text-decoration-line", `${decorationOf(element)} ${value}`);
}

function setSelectionValue(command: string, value: Value) {
  if (selected(isFormattable).length === 0) {
    const { activeValues } = commands[command];
    if (isScript(command)) overrides().$delete(command === "subscript" ? "superscript" : "subscript");
    if (activeValues !== undefined) overrides().$set(command, activeValues.includes(value!));
    else if (value === null) overrides().$delete(overrideKey(command));
    else overrides().$set(overrideKey(command), value);
    return;
  }
  splitTextAtEnds();
  for (const element of selected(it => it.type === ELEMENT && isEditable(it))) clearValue(element, command);
  const nodes = new Set(selected(isEditable));
  const alone = new Set([...nodes].filter(it => it.first !== null && !nodes.$has(it.prev!) && !nodes.$has(it.next!)));
  for (const node of nodes) {
    pushDownValues(node, command, value);
    if (!isAllowedChild(node, "span")) continue;
    if (!alone.$has(node)) forceValue(node, command, value);
    else if (value !== null && !has(node, command, value)) setOwnValue(node, command, value);
  }
}

const selectedValues = (command: string) => selected(isFormattable).map(it => effectiveValue(it, command));
const firstValue = (command: string) => effectiveValue(selected(isFormattable)[0] ?? active.startNode, command);

function stateOf(command: string): boolean {
  const override = overrides().$get(command);
  return typeof override === "boolean" ? override : (commands[command].state?.() ?? false);
}

function valueOf(command: string): string {
  const override = overrides().$get(overrideKey(command));
  if (typeof override !== "string") return commands[command].value!();
  return command === "fontsize" ? legacySize(override) : override;
}

function defineToggle(name: string, activeValues: string[], off: Value, property?: string) {
  const isOn = (value: Value) => activeValues.includes(value!);
  commands[name] = {
    activeValues,
    property,
    run() {
      const wasOn = stateOf(name);
      if (wasOn || isScript(name)) setSelectionValue(name, off);
      if (!wasOn) setSelectionValue(name, activeValues[0]);
      return true;
    },
    state() {
      const values = selectedValues(name);
      return values.length === 0 ? isOn(firstValue(name)) : values.every(isOn);
    },
    indeterminate() {
      const values = selectedValues(name);
      return (values.some(isOn) && !values.every(isOn)) || values.includes("mixed");
    },
  };
}
defineToggle("bold", ["bold", "600", "700", "800", "900"], "normal", "font-weight");
defineToggle("italic", ["italic", "oblique"], "normal", "font-style");
defineToggle("strikethrough", ["line-through"], null);
defineToggle("underline", ["underline"], null);
defineToggle("subscript", ["subscript"], null);
defineToggle("superscript", ["superscript"], null);
commands.bold.normalize = value => (value === "bold" ? "700" : value === "normal" ? "400" : value);

function defineValue(
  name: string,
  property: string,
  parse: (value: string) => Value,
  normalize?: (value: string) => unknown,
) {
  commands[name] = {
    property,
    normalize,
    run(value) {
      const parsed = parse(value);
      if (parsed !== null) setSelectionValue(name, parsed);
      return parsed !== null || normalize !== undefined;
    },
    indeterminate: () => new Set(selectedValues(name)).size > 1,
    value: () => firstValue(name) ?? "",
  };
}

/** 0xRRGGBBAA, or -1. */
const parseColor = (text: string): number =>
  asciiLower(text) === "currentcolor" ? -1 : +engine.parseColor(text, 0xff);

function simpleColor(text: string): Value {
  const color = parseColor(text);
  return color >= 0 && (color & 255) === 255 ? "#" + (color >>> 8).toString(16).padStart(6, "0") : null;
}

function colorArgument(value: string): Value {
  if (/^(?:[0-9a-f]{3}){1,2}$/i.test(value)) value = "#" + value;
  return parseColor(value) >= 0 || /^(?:rgb|hsl)a?\(.*\)$/.test(value) ? value : null;
}

function sizeKeyword(value: string): Value {
  const parts = /^([-+]?)(\d+)(?:\.\d+)?(?:e[-+]?\d+)?$/i.exec(value.trim());
  if (parts === null) return null;
  const size = parts[1] === "+" ? 3 + +parts[2] : parts[1] === "-" ? 3 - +parts[2] : +parts[2];
  return sizes[Math.min(Math.max(size, 1), 7) - 1];
}

function legacySize(size: string): string {
  const keyword = sizes.indexOf(sizeKeyword(size) ?? size);
  if (keyword >= 0) return String(keyword + 1);
  const pixels = parseInt(size);
  return String(pixelSizes.findIndex((it, index) => index === 6 || pixels < (it + pixelSizes[index + 1]) / 2) + 1);
}

defineValue("backcolor", "background-color", colorArgument, parseColor);
defineValue("hilitecolor", "background-color", colorArgument, parseColor);
defineValue("forecolor", "color", colorArgument, parseColor);
defineValue("fontname", "font-family", value => value);
defineValue("fontsize", "font-size", sizeKeyword);
commands.fontsize.value = () => legacySize(firstValue("fontsize") ?? "medium");

commands.createlink = {
  run(value) {
    if (value === "") return false;
    for (const node of selected(() => true)) {
      for (const it of ancestors(node)) if (isAnchor(it) && isEditable(it)) setAttribute(it, "href", value);
    }
    setSelectionValue("createlink", value);
    return true;
  },
};

commands.unlink = {
  run() {
    const around = [active.startNode, ...ancestors(active.startNode)].reverse();
    const isReached = (it: N) => isContained(it, active) || contains(it, active.endNode);
    const inside = collect(active.startNode, followingSkip(active.endNode, null), isReached, false);
    for (const link of [...new Set([...around, ...inside])].filter(it => isAnchor(it) && isEditable(it))) {
      keepingValues(children(link), () => unwrap(link));
    }
    return true;
  },
};

commands.removeformat = {
  run() {
    const isCandidate = (node: Maybe) => isIn(node, formatting) && isEditable(node);
    selected(isCandidate).forEach(unwrap);
    splitTextAtEnds();
    for (const node of selected(isEditable))
      while (isCandidate(node.parent) && shareHost(node.parent, node)) splitParent([node]);
    for (const command of recorded) setSelectionValue(command, null);
    return true;
  },
};

type Formats = [command: string, value: boolean | Value][];

function selectedFormats(): Formats {
  const node = selected(isFormattable)[0];
  if (node === undefined || isHtml(node, "img")) return [];
  const isInLink = effectiveValue(node, "createlink") !== null;
  const formats: Formats = [
    ...toggles.map((it): Formats[0] => [it, commands[it].activeValues!.includes(effectiveValue(node, it)!)]),
    ...valued.map((it): Formats[0] => [it, commands[it].value!()]),
    ["fontsize", effectiveValue(node, "fontsize")],
  ];
  const isOfLink = (it: string) =>
    (it === "underline" || it === "forecolor") && nearestSpecifiedValue(node, it) === null;
  return isInLink ? formats.filter(it => !isOfLink(it[0])) : formats;
}

function currentOverrides(): Formats {
  const all = overrides();
  return ["createlink", ...toggles, ...valued].filter(it => all.$has(it)).map(it => [it, all.$get(it)!]);
}

function restoreFormats(formats: Formats) {
  let node = selected(isFormattable)[0];
  for (const [command, value] of formats) {
    if (value === null) continue;
    if (node === undefined) {
      overrides().$set(command, value);
      continue;
    }
    if (typeof value === "boolean") {
      if (stateOf(command) !== value) commands[command].run("");
    } else if (command === "createlink" || command === "fontsize") {
      const override = overrides().$get(command);
      if (override === undefined ? has(node, command, value) : override === value) continue;
      commands[command].run(command === "fontsize" ? legacySize(value) : value);
    } else if (!areEquivalent(command, valueOf(command), value)) commands[command].run(value);
    node = selected(isFormattable)[0] ?? node;
  }
}

// ───────────────────────────── blocks ─────────────────────────────

function isIndentation(node: Maybe): boolean {
  return (
    isHtml(node, "blockquote") || (isHtml(node, "div") && styledProperties(node!).some(it => it.startsWith("margin")))
  );
}

function isSimpleIndentation(node: Maybe): boolean {
  return (
    isIndentation(node) &&
    (node!.attrs ?? []).every((it, index) => index % 2 === 1 || it === "style" || it === "dir") &&
    styledProperties(node!).every(it => /^(?:margin|border|padding)/.test(it))
  );
}

const isLineContainer = (node: Maybe) => isIn(node, lineContainers) || isIn(node, items);
const hasBlocks = (node: N) => descendants(node).some(it => isIn(it, notInParagraphs));
const fitsNowhere = (node: N) => ancestors(node).every(it => !shareHost(node, it) || !isAllowedChild(node, it));

function blockOf(node: N): N {
  while (isInline(node) && node.parent !== null) node = node.parent;
  return node;
}

function fixDisallowedAncestors(node: Maybe) {
  if (node === null || !isEditable(node)) return;
  if (!fitsNowhere(node)) {
    return keepingValues([node], () => {
      while (!isAllowedChild(node, node.parent!) && splitParent([node]));
    });
  }
  if (isIn(node, definitions))
    return void wrap(
      [node],
      it => isHtml(it, "dl") && attributeCount(it) === 0,
      () => create("dl"),
    );
  if (!isAllowedChild("p", hostOf(node)!) || !isIn(node, notInParagraphs) || isHtml(node, state.separator)) return;
  const renamed = rename(node, state.separator);
  fixDisallowedAncestors(renamed);
  for (const it of children(renamed)) if (isIn(it, notInParagraphs)) keepingValues([it], () => splitParent([it]));
}

function normalizeSublists(item: Maybe) {
  if (!isHtml(item, "li") || !isEditable(item) || !isEditable(item!.parent)) return;
  let made: Maybe = null;
  while (childArray(item!).some(it => isIn(it, lists))) {
    const last = item!.last!;
    if (isIn(last, lists) || (made === null && last.type === TEXT && /^[ \t\n\f\r]*$/.test(last.data))) {
      made = null;
      move(last, item!.parent!, indexOf(item!) + 1);
    } else {
      if (made === null) insert((made = create("li")), item!.parent!, item!.next);
      move(last, made, 0);
    }
  }
}

function normalizeSelectedSublists() {
  const around = (node: N) => [node, ...ancestors(node)].reverse();
  for (const it of new Set([...around(active.startNode), ...around(active.endNode)])) normalizeSublists(it);
}

function canBeListed(node: N): boolean {
  return (
    isEditable(node) &&
    !isIndentation(node) &&
    (isIn(node, lists) || isIn(node.parent, lists) || isAllowedChild(node, "li"))
  );
}

function listState(): string {
  const nodes = contained(blockExtend(active), canBeListed);
  const isOf = (node: N, name: string) =>
    isHtml(node, name) || isHtml(node.parent, name) || (isHtml(node.parent, "li") && isHtml(node.parent!.parent, name));
  const holds = (node: N, name: string) => isHtml(node, name) || descendants(node).some(it => isHtml(it, name));
  if (nodes.length === 0) return "none";
  if (nodes.every(it => isOf(it, "ol") && !holds(it, "ul"))) return "ol";
  if (nodes.every(it => isOf(it, "ul") && !holds(it, "ol"))) return "ul";
  const [hasOl, hasUl] = ["ol", "ul"].map(name => nodes.some(it => isOf(it, name) || holds(it, name)));
  return hasOl && hasUl ? "mixed" : hasOl ? "mixed ol" : hasUl ? "mixed ul" : "none";
}

function alignmentOf(node: Maybe): string {
  while (node !== null && (node.type !== ELEMENT || /^(?:inline|none)$/.test(css(node, "display")))) node = node.parent;
  if (node === null) return "left";
  const value = css(node, "text-align").replace("-webkit-", "");
  if (value === "start" || value === "end")
    return (value === "start") === (css(node, "direction") === "ltr") ? "left" : "right";
  return /^(?:center|justify|right)$/.test(value) ? value : "left";
}

function lastEquivalentPoint(node: N, offset: number): Point {
  while (lengthOf(node) > 0) {
    const next = child(node, offset);
    if (offset === lengthOf(node) && node.parent !== null && isInline(node) && !isHost(node)) {
      [node, offset] = [node.parent, indexOf(node) + 1];
    } else if (next !== null && lengthOf(next) > 0 && isInline(next) && isEditable(next)) [node, offset] = [next, 0];
    else break;
  }
  return [node, offset];
}

function firstEquivalentPoint(node: N, offset: number): Point {
  while (lengthOf(node) > 0) {
    const previous = child(node, offset - 1);
    if (offset === 0 && node.parent !== null && isInline(node) && !isHost(node))
      [node, offset] = [node.parent, indexOf(node)];
    else if (previous !== null && lengthOf(previous) > 0 && isInline(previous) && isEditable(previous)) {
      [node, offset] = [previous, lengthOf(previous)];
    } else break;
  }
  return [node, offset];
}

function isBlockStart(node: N, offset: number): boolean {
  const before = child(node, offset - 1);
  return (node.parent === null && offset === 0) || ((isBlock(before) || isBreak(before)) && isVisible(before));
}

function isBlockEnd(node: N, offset: number): boolean {
  const after = child(node, offset);
  return (node.parent === null && offset === lengthOf(node)) || (isBlock(after) && isVisible(after));
}
const isBlockBoundary = (node: N, offset: number) => isBlockStart(node, offset) || isBlockEnd(node, offset);

function blockExtend({ startNode, startOffset, endNode, endOffset }: R): R {
  const up = (node: N, isAfter: boolean): Point => [node.parent!, indexOf(node) + +isAfter];
  let item = core.closestHtml(startNode, "li");
  if (item !== null) [startNode, startOffset] = up(item, false);
  if (!isBlockStart(startNode, startOffset)) {
    do {
      if (startOffset === 0) [startNode, startOffset] = up(startNode, false);
      else startOffset = startNode.type === TEXT ? 0 : startOffset - 1;
    } while (!isBlockBoundary(startNode, startOffset));
  }
  while (startOffset === 0 && startNode.parent !== null) [startNode, startOffset] = up(startNode, false);
  if ((item = core.closestHtml(endNode, "li")) !== null) [endNode, endOffset] = up(item, true);
  if (!isBlockEnd(endNode, endOffset)) {
    do {
      if (endOffset === lengthOf(endNode)) [endNode, endOffset] = up(endNode, true);
      else endOffset = endNode.type === TEXT ? endNode.data.length : endOffset + 1;
    } while (!isBlockBoundary(endNode, endOffset));
  }
  while (endOffset === lengthOf(endNode) && endNode.parent !== null) [endNode, endOffset] = up(endNode, true);
  return rangeOf(startNode, startOffset, endNode, endOffset).$impl;
}

function followsBreak(node: N): boolean {
  for (let offset = 0; !isBlockBoundary(node, offset);) {
    const before = child(node, offset - 1);
    if (isVisible(before)) return before!.type !== ELEMENT ? /\n$/.test(before!.data) && keepsBreaks(before!) : false;
    if (before === null) [node, offset] = [node.parent!, indexOf(node)];
    else offset--;
  }
  return true;
}

function precedesBreak(node: N): boolean {
  for (let offset = lengthOf(node); !isBlockBoundary(node, offset);) {
    const after = child(node, offset);
    if (isVisible(after)) return false;
    if (after === null) [node, offset] = [node.parent!, indexOf(node) + 1];
    else offset++;
  }
  return true;
}

/** Whether it could. */
function splitParent(nodes: N[]): boolean {
  const parent = nodes[0].parent;
  if (!isEditable(parent) || parent!.parent === null) return false;
  const [first, last, outer] = [nodes[0], nodes.at(-1)!, parent!.parent];
  const [hasFirst, hasLast] = [first === parent!.first, last === parent!.last];
  if (hasFirst) trimBreakBefore(parent!);
  const followed = hasFirst && followsBreak(parent!);
  const preceded = hasLast && precedesBreak(parent!);
  const endLine = () => preceded && !precedesBreak(last) && addBreak(last.parent!, last.next);
  if (!hasFirst && hasLast) {
    for (const node of nodes.toReversed()) move(node, outer, indexOf(parent!) + 1);
    endLine();
    trimBreakAtEnd(parent!);
    return true;
  }
  if (!hasFirst) {
    const copy = core.clone(parent!, doc, false);
    setAttribute(parent!, "id", null);
    insert(copy, outer, parent);
    while (first.prev !== null) move(parent!.first!, copy, -1);
  }
  for (const node of nodes) move(node, outer, indexOf(parent!));
  if (followed && !followsBreak(first)) addBreak(first.parent!, first);
  if (isInline(last) && !isBreak(last) && isBreak(parent!.first) && isBlock(parent)) remove(parent!.first!);
  if (parent!.first === null) {
    remove(parent!);
    endLine();
  } else trimBreakBefore(parent!);
  if (last.next === null && last.parent !== null) trimBreakAtEnd(last.parent);
  return true;
}

function removeKeepingChildren(node: N) {
  if (node.first !== null) splitParent(children(node));
  else remove(node);
}

function spaceSequence(length: number, atStart: boolean, atEnd: boolean): string {
  if (length < 2) return length === 0 ? "" : atStart || atEnd ? "\xa0" : " ";
  const pairs = (atStart ? "\xa0 " : " \xa0").repeat((length - 2) >> 1);
  if (length % 2 === 1) return pairs + (atStart ? (atEnd ? "\xa0 \xa0" : "\xa0\xa0 ") : atEnd ? " \xa0\xa0" : " \xa0 ");
  return pairs + (atEnd ? (atStart ? "\xa0\xa0" : " \xa0") : "\xa0 ");
}

/** The spaces around a point become ones that all show. */
function canonicalizeWhitespace(node: N, offset: number, removesCollapsed = true) {
  if (hostOf(node) === null) return;
  const isSpace = (text: N, at: number) =>
    text.type === TEXT && /[ \xa0\t\n\r]/.test(text.data[at] ?? "") && isFluid(text, at);
  const isFluid = (text: N, at: number) => !keepsSpaces(text) && !(text.data[at] === "\n" && keepsBreaks(text));
  const isCollapsible = (text: N, at: number) => isSpace(text, at) && text.data[at] !== "\xa0";
  const enters = (from: N, it: Maybe) => it !== null && shareHost(from, it) && !isBreak(it) && !isAtomic(it);
  const startsLine = (at: N, index: number) =>
    index === 0 ? followsBreak(at) : at.type === TEXT ? at.data[index - 1] === "\n" : isBreak(child(at, index - 1));
  const endsLine = (at: N, index: number) =>
    index === lengthOf(at) ? precedesBreak(at) : at.type === TEXT ? at.data[index] === "\n" : isBreak(child(at, index));
  while (true) {
    const before = child(node, offset - 1);
    if (enters(node, before)) [node, offset] = [before!, lengthOf(before!)];
    else if (offset === 0 && !followsBreak(node) && shareHost(node, node.parent))
      [node, offset] = [node.parent!, indexOf(node)];
    else if (isSpace(node, offset - 1)) offset--;
    else break;
  }
  let [end, endOffset, length] = [node, offset, 0];
  let collapses = startsLine(node, offset);
  while (true) {
    const after = child(end, endOffset);
    if (enters(end, after)) [end, endOffset] = [after!, 0];
    else if (endOffset === lengthOf(end) && !precedesBreak(end) && shareHost(end, end.parent)) {
      [end, endOffset] = [end.parent!, indexOf(end) + 1];
    } else if (!isSpace(end, endOffset)) break;
    else if (removesCollapsed && collapses && isCollapsible(end, endOffset)) core.replaceData(end, endOffset, 1, "");
    else {
      collapses = isCollapsible(end, endOffset++);
      length++;
    }
  }
  while (removesCollapsed && comparePoints(node, offset, end, endOffset) < 0) {
    const before = child(end, endOffset - 1);
    if (enters(end, before)) [end, endOffset] = [before!, lengthOf(before!)];
    else if (endOffset === 0 && shareHost(end, end.parent)) [end, endOffset] = [end.parent!, indexOf(end)];
    else if (endOffset === lengthOf(end) && isCollapsible(end, endOffset - 1) && precedesBreak(end)) {
      core.replaceData(end, --endOffset, 1, "");
      length--;
    } else break;
  }
  const wanted = spaceSequence(length, startsLine(node, offset), endsLine(end, endOffset));
  for (let at = 0; comparePoints(node, offset, end, endOffset) < 0;) {
    const after = child(node, offset);
    if (after !== null) [node, offset] = [after, 0];
    else if (node.type !== TEXT || offset === node.data.length) [node, offset] = [node.parent!, indexOf(node) + 1];
    else {
      const space = wanted[at++] ?? " ";
      if (space === "\xa0" ? node.data[offset] !== space : node.data[offset] === "\xa0") {
        core.replaceData(node, offset, 0, space);
        core.replaceData(node, offset + 1, 1, "");
      }
      offset++;
    }
  }
}

function canonicalizeEnds(removesCollapsed: boolean) {
  canonicalizeWhitespace(active.startNode, active.startOffset, removesCollapsed);
  canonicalizeWhitespace(active.endNode, active.endOffset, removesCollapsed);
}

function mergeableBlock(node: N): Maybe {
  while (shareHost(node, node.parent) && isInline(node)) node = node.parent!;
  return (isBlock(node) || isHost(node)) && isAllowedChild("span", node) && !isIn(node, cells) ? node : null;
}

/** The siblings from `from` to the end of the line, which is made a `<br>` among them. */
function firstLine(from: Maybe): N[] {
  const parent = from?.parent ?? null;
  let end: Maybe = null;
  for (
    let at = from;
    end === null && isInline(at);
    at = isUnit(at) ? followingSkip(at, parent) : following(at!, parent)
  ) {
    const newline = at!.type === TEXT && keepsBreaks(at!) ? at!.data.indexOf("\n") : -1;
    if (isBreak(at)) end = at;
    else if (newline >= 0) {
      if (newline + 1 < at!.data.length) core.splitText(at!, newline + 1);
      core.replaceData(at!, newline, 1, "");
      end = addBreak(at!.parent!, at!.next);
      if (at!.data !== "") continue;
      if (at === from) from = end;
      remove(at!);
    }
  }
  while (end !== null && end.parent !== parent) {
    const wrapper = end.parent!;
    if (wrapper === from && end.prev === null) from = end;
    if (end.next !== null && end.prev !== null) {
      const copy = core.clone(wrapper, doc, false);
      core.removeAttr(copy, "id");
      insert(copy, wrapper.parent!, wrapper.next);
      while (end.next !== null) move(end.next, copy, -1);
    }
    move(end, wrapper.parent!, indexOf(wrapper) + +(end.prev !== null));
    if (wrapper.first === null) remove(wrapper);
  }
  const nodes: N[] = [];
  for (; isInline(from) && !isBreak(nodes.at(-1)); from = from!.next) nodes.push(from!);
  return nodes;
}

/** What `<pre>` has by itself does not count. */
function authoredWhiteSpace(node: N): string {
  let at = node.type === ELEMENT ? node : node.parent!;
  const value = css(at, "white-space");
  while (at.parent?.type === ELEMENT && css(at.parent, "white-space") === value) at = at.parent;
  return isIn(at, preformatted) && !core.sync(doc).isSetByAuthor(at.id, "white-space-collapse")
    ? authoredWhiteSpace(at.parent!)
    : value;
}

/** `nodes` keep the white space that they have in their block. */
function keepingWhiteSpace(nodes: N[], change: () => void) {
  const before = nodes.map(authoredWhiteSpace);
  change();
  let made: Maybe = null;
  nodes.forEach((node, index) => {
    if (node.parent === null || isBreak(node) || !isVisible(node) || authoredWhiteSpace(node.parent) === before[index])
      return;
    if (node.type === ELEMENT) {
      if (inlineStyle(node, "white-space") === "") setStyle(node, "white-space", before[index]);
      return;
    }
    if (made === null || made !== node.prev || before[index] !== before[index - 1]) {
      insert((made = create("span")), node.parent, node);
      setStyle(made, "white-space", before[index]);
    }
    move(node, made, -1);
  });
}

function prune(node: N) {
  while (isEditable(node.parent) && childArray(node.parent!).every(it => it === node || isInvisible(it)))
    node = node.parent!;
  remove(node);
}

function caretX(node: N): number {
  return core.sync(doc).caretRect(ranges.pointId(node), ranges.pointOffset(node, 0), false)[0];
}

/** `endsWithBreak`: the line to add to still has its end. */
function mergeBlocks(start: N, end: N, endsWithBreak: boolean, isEndEmptied: boolean) {
  const isEmpty = start.first === start.last && isBlockProp(start.first);
  if (isEmpty && !isEndEmptied && !contains(end, start) && isEditable(start) && caretX(end) > caretX(start)) {
    select(end, 0);
    return prune(start);
  }
  if (isEmpty) remove(start.first!);
  const childOf = (parent: N, node: N) => {
    while (node.parent !== parent) node = node.parent!;
    return node;
  };
  let moved: N[];
  let change: () => void;
  if (contains(start, end)) {
    collapseBefore(childOf(start, end));
    if (end.first === null) {
      while (isEditable(end) && end.prev === null && end.next === null && end.parent !== start) end = end.parent!;
      if (!isEditable(end)) return;
      if (isInline(end.prev) && isInline(end.next)) addBreak(end.parent!, end.next);
      return remove(end);
    }
    if (beside(childOf(start, end), false) !== Beside.Content && !endsWithBreak) return select(end, 0);
    if ((moved = firstLine(end.first)).length === 0) return;
    change = () => {
      while (moved[0].parent !== start && splitParent(moved));
      if (isBreak(moved[0].prev) && isEditable(moved[0].prev)) remove(moved[0].prev!);
    };
  } else {
    select(start, lengthOf(start));
    const isInside = contains(end, start);
    const next = isInside ? childOf(end, start).next : end.first;
    if (isInline(next) && isBreak(start.last)) remove(start.last!);
    moved = firstLine(next);
    change = () => {
      for (const node of moved) move(node, start, -1);
      if (isInside) return;
      while (isRemovable(end.first) && childArray(end).every(isInvisible)) remove(end.first!);
      while (end.first === null && isEditable(end)) {
        const parent = end.parent!;
        remove(end);
        end = parent;
        if (!contains(end, start) && childArray(end).every(it => it.type === TEXT && isInvisible(it)))
          children(end).forEach(remove);
      }
    };
  }
  keepingValues(moved, () => {
    keepingWhiteSpace(moved, change);
    for (let at: Maybe = start; shareHost(at, start); at = at!.parent) {
      while (isIn(at, lists) && isHtml(at!.next, at!.name) && shareHost(at, at!.next)) {
        moveChildren(at!.next!, at!);
        remove(at!.next!);
      }
    }
  });
  if (start.first === null) addBreak(start);
  trimBreakAtEnd(start);
}

const isInert = (node: N) => css(node.type === ELEMENT ? node : node.parent!, "interactivity") === "inert";

function deleteSelection(mergesBlocks = true, stripsWrappers = true, isForward = true) {
  canonicalizeEnds(true);
  let [startNode, startOffset] = lastEquivalentPoint(active.startNode, active.startOffset);
  let [endNode, endOffset] = firstEquivalentPoint(active.endNode, active.endOffset);
  if (comparePoints(endNode, endOffset, startNode, startOffset) <= 0) return collapse(isForward);
  const isOfList = (node: Maybe) => (isIn(node, lists) || isIn(node, items)) && isEditable(node);
  if (isOfList(child(startNode, startOffset)) && endOffset === lengthOf(endNode) && isOfList(endNode.last)) {
    while (isOfList(child(startNode, startOffset))) [startNode, startOffset] = [child(startNode, startOffset)!, 0];
    while (isOfList(endNode.last)) endOffset = lengthOf((endNode = endNode.last!));
  }
  if (startNode.type === TEXT && startOffset === 0) [startNode, startOffset] = [startNode.parent!, indexOf(startNode)];
  if (endNode.type === TEXT && endOffset === endNode.data.length)
    [endNode, endOffset] = [endNode.parent!, indexOf(endNode) + 1];
  select(startNode, startOffset, endNode, endOffset);
  const [startBlock, endBlock] = [mergeableBlock(startNode), mergeableBlock(endNode)];
  const hasContent = (block: Maybe) =>
    block !== null && childArray(block).some(it => isVisible(it) && !isBlockProp(it));
  const endHadContent = hasContent(endBlock);
  const formats = selectedFormats();
  const endsWithBreak = isExtraneousBreak(child(startNode, startOffset - 1));
  const isMutableText = (node: N) => node.type === TEXT && isEditable(node) && !isInert(node);
  if (startNode === endNode && isMutableText(startNode)) {
    core.replaceData(startNode, startOffset, endOffset - startOffset, "");
    canonicalizeWhitespace(startNode, startOffset, false);
    collapse(isForward);
    keepLastLine();
    return restoreFormats(formats);
  }
  if (isMutableText(startNode)) core.replaceData(startNode, startOffset, startNode.data.length - startOffset, "");
  for (const node of contained(
    active,
    it => (isEditable(it) || isEditable(it.parent) || isHost(it.parent)) && !isIn(it, tableParts),
  )) {
    let parent = node.parent!;
    remove(node);
    const strips = stripsWrappers || !contains(parent, startNode);
    while (strips && parent.first === null && isEditable(parent) && isInline(parent)) {
      const empty = parent;
      parent = parent.parent!;
      remove(empty);
    }
    const block = blockOf(parent);
    if (shareHost(block, parent) && !childArray(block).some(isVisible) && isAllowedChild("br", parent))
      addBreak(parent);
  }
  if (isMutableText(endNode)) core.replaceData(endNode, 0, endOffset, "");
  canonicalizeEnds(false);
  if (mergesBlocks && startBlock !== endBlock && shareHost(startBlock, endBlock)) {
    mergeBlocks(startBlock!, endBlock!, endsWithBreak, endHadContent && !hasContent(endBlock));
  } else collapse(isForward);
  keepLastLine();
  restoreFormats(formats);
}

function isBetweenUneditableBlocks(node: N, offset: number): boolean {
  const sides = [child(node, offset - 1), child(node, offset)];
  return (
    isBlock(node) && sides.some(it => it !== null) && sides.every(it => it === null || (isBlock(it) && !isEditable(it)))
  );
}

/** A newline at the end of a block begins no line. */
function keepLastLine() {
  const [node, offset] = firstEquivalentPoint(active.startNode, active.startOffset);
  if (!active.collapsed || hostOf(node) === null) return;
  const before = child(node, offset - 1);
  if (node.type === TEXT) {
    if (
      offset < node.data.length ||
      !node.data.endsWith("\n") ||
      !keepsBreaks(node) ||
      beside(node, true) !== Beside.Edge
    )
      return;
    core.replaceData(node, offset, 0, "\n");
    select(node, offset);
  } else if (isCollapsedBreak(before) ? isAllowedChild("br", node) : isBetweenUneditableBlocks(node, offset)) {
    addBreak(node, child(node, offset));
    select(node, offset);
  }
}

function deleteRange(node: N, offset: number, endNode: N, endOffset: number, isForward = true): true {
  select(node, offset, endNode, endOffset);
  deleteSelection(true, true, isForward);
  return true;
}

function indentNodes(nodes: N[]) {
  if (nodes.length === 0) return;
  const parent = nodes[0].parent;
  if (isIn(parent, lists))
    wrap(
      nodes,
      it => isHtml(it, parent!.name),
      () => create(parent!.name),
    );
  else fixDisallowedAncestors(wrap(nodes, isSimpleIndentation, () => create("blockquote")));
}

function outdentNode(node: N) {
  if (!isEditable(node)) return;
  if (isSimpleIndentation(node)) return removeKeepingChildren(node);
  if (isIndentation(node)) {
    setAttribute(node, "dir", null);
    for (const property of ["margin", "padding", "border"]) setStyle(node, property, "");
    return void rename(node, "div");
  }
  const upTo = (test: Test) => {
    const path = [node.parent!];
    while (isEditable(path.at(-1)) && !test(path.at(-1)!) && !isIn(path.at(-1), lists)) path.push(path.at(-1)!.parent!);
    return path;
  };
  let path = upTo(isSimpleIndentation);
  if (!isEditable(path.at(-1)) || !isSimpleIndentation(path.at(-1)!)) path = upTo(isIndentation);
  const indentation = path.at(-1)!;
  if (!isEditable(indentation) || !isIndentation(indentation)) {
    if (!isIn(node, lists)) return;
    for (const name of ["reversed", "start", "type"]) setAttribute(node, name, null);
    const inside = children(node);
    if (attributeCount(node) > 0 && !isIn(node.parent, lists)) rename(node, "div");
    else keepingValues(inside, () => removeKeepingChildren(node));
    return inside.forEach(fixDisallowedAncestors);
  }
  while (path.length > 0) {
    const ancestor = path.pop()!;
    const target = node.parent === ancestor ? node : path.at(-1)!;
    if (isInline(target) && !isBreak(target) && isBreak(target.next)) remove(target.next!);
    const [siblings, index] = [children(ancestor), indexOf(target)];
    indentNodes(siblings.slice(0, index));
    indentNodes(siblings.slice(index + 1));
  }
  outdentNode(indentation);
}

/** Takes the siblings at the start of `nodes`. */
function takeRun(nodes: N[], goesOn: (next: N, last: N) => boolean = () => true): N[] {
  const run = [nodes.shift()!];
  while (nodes.length > 0 && nodes[0] === run.at(-1)!.next && goesOn(nodes[0], run.at(-1)!)) run.push(nodes.shift()!);
  return run;
}

function leaveList(run: N[]) {
  keepingValues(run, () => {
    splitParent(run);
    run.forEach(fixDisallowedAncestors);
  });
}

function toggleList(name: string): true {
  const turnsOff = listState() === name;
  const other = name === "ol" ? "ul" : "ol";
  const isList = (node: Maybe) => isHtml(node, name);
  const isEditableList = (node: Maybe) => isList(node) && isEditable(node);
  normalizeSelectedSublists();
  const range = blockExtend(active);
  if (turnsOff) {
    for (const nodes = contained(range, canBeListed); nodes.length > 0;) {
      if (isList(nodes[0])) outdentNode(nodes.shift()!);
      else leaveList(takeRun(nodes, next => !isList(next)));
    }
    return true;
  }
  const changeList = (run: N[], make?: () => N) =>
    keepingValues(run, () => {
      splitParent(run);
      wrap(run, isList, make);
    });
  for (const list of contained(range, it => isHtml(it, other) && isEditable(it), false)) {
    if (!isEditableList(list.prev) && !isEditableList(list.next)) rename(list, name);
    else if (list.first !== null) changeList(children(list));
  }
  const nodes = contained(range, canBeListed).filter(it => !isIn(it, lists) || isIn(it.parent, lists));
  while (nodes.length > 0) {
    const run: N[] = [];
    while (nodes.length > 0 && (run.length === 0 || nodes[0] === run.at(-1)!.next)) {
      if (isHtml(nodes[0], "p") || isHtml(nodes[0], "div")) run.push(rename(nodes.shift()!, "li"));
      else if (isHtml(nodes[0], "li") || isIn(nodes[0], lists)) run.push(nodes.shift()!);
      else {
        const line = takeRun(nodes, (next, last) => isInline(next) && isInline(last) && !isBreak(last));
        const item = wrap(line, never, () => create("li"));
        if (item !== null) run.push(item);
        while (nodes.length > 0 && item !== null && contains(item, nodes[0])) nodes.shift();
      }
    }
    if (run.length === 0 || isList(run[0].parent) || run.every(it => isIn(it, lists))) continue;
    if (isHtml(run[0].parent, other)) {
      changeList(run, () => create(name));
      continue;
    }
    const make = () => {
      const parent = run[0].parent!;
      if (!isEditable(parent) || !isSimpleIndentation(parent) || !isEditableList(parent.prev)) return create(name);
      normalizeSublists(parent.prev!.last);
      if (!isEditableList(parent.prev!.last)) insert(create(name), parent.prev!, null);
      return parent.prev!.last;
    };
    fixDisallowedAncestors(wrap(run, isList, make));
  }
  return true;
}

function justify(alignment: string): true {
  const isAligned = (it: N) => hasAttr(it, "align") || inlineStyle(it, "text-align") !== "" || isHtml(it, "center");
  for (const element of contained(
    blockExtend(active),
    it => it.type === ELEMENT && isEditable(it) && isAligned(it),
    false,
  )) {
    setAttribute(element, "align", null);
    setStyle(element, "text-align", "");
    if (attributeCount(element) > 0) {
      if (isHtml(element, "center")) rename(element, "div");
    } else if (/^(?:div|span|center)$/.test(element.name)) removeKeepingChildren(element);
  }
  const onlyAligns = (it: N) =>
    isHtml(it, "div") &&
    (it.attrs ?? []).every((name, index) => {
      if (index % 2 === 1) return true;
      if (name === "align") return asciiLower(getAttr(it, name)!) === alignment;
      return name === "style" && styledProperties(it).length === 1 && inlineStyle(it, "text-align") === alignment;
    });
  const make = () => {
    const made = create("div");
    core.setAttr(made, "style", `text-align: ${alignment};`);
    return made;
  };
  const isOff = (it: N) => isEditable(it) && isAllowedChild(it, "div") && alignmentOf(it) !== alignment;
  for (const nodes = contained(blockExtend(active), isOff); nodes.length > 0;) wrap(takeRun(nodes), onlyAligns, make);
  return true;
}

const selectedLeaves = () =>
  contained(blockExtend(active), it => it.first === null && isEditable(it) && isVisible(it), false);

/** What is typed after it gets the formats that were meant for what is typed before it. */
function defineBlockCommand(name: string, run: (value: string) => boolean, more?: Partial<Command>) {
  commands[name] = {
    ...more,
    run(value) {
      const formats = currentOverrides();
      const result = run(value);
      if (active.collapsed) restoreFormats(formats);
      return result;
    },
  };
}

for (const alignment of ["center", "justify", "left", "right"]) {
  const matches = () => selectedLeaves().map(it => alignmentOf(it) === alignment);
  defineBlockCommand("justify" + alignment.replace("justify", "full"), () => justify(alignment), {
    indeterminate: () => new Set(matches()).size > 1,
    state: () => matches().length > 0 && !matches().includes(false),
    value: () => alignmentOf(selectedLeaves()[0] ?? null),
  });
}

for (const [name, tag] of [
  ["insertorderedlist", "ol"],
  ["insertunorderedlist", "ul"],
]) {
  defineBlockCommand(name, () => toggleList(tag), {
    indeterminate: () => ["mixed", "mixed " + tag].includes(listState()),
    state: () => listState() === tag,
  });
}

let graphemes: Intl.Segmenter | undefined;

function clusterAt(text: string, offset: number): [start: number, end: number] {
  const from = Math.max(0, offset - 128);
  const found = (graphemes ??= new Intl.Segmenter()).segment(text.slice(from, offset + 128)).containing(offset - from)!;
  return [from + found.index, from + found.index + found.segment.length];
}

/** Backspace takes a combining mark off a letter, but the whole of an emoji. */
function beforeBackspace(text: string, offset: number): number {
  const isMark = /[\p{M}\u1160-\u11ff]/u.test(text[offset - 1]) && !/[︀-️⃣]/.test(text[offset - 1]);
  return isMark ? offset - 1 : clusterAt(text, offset - 1)[0];
}

/** Deleted as a whole. */
const isUnit = (node: Maybe) =>
  node !== null &&
  (isBreak(node) || isHtml(node, "hr") || isIn(node, replaced) || node.ns === SVG || !isEditable(node));

/** A block that cannot be edited goes when what is around it is joined. */
function isObstacle(node: Maybe): boolean {
  if (!isBlock(node) || isHtml(node, "hr")) return false;
  return !isEditable(node) || (isIn(node, lists) && childArray(node!).every(it => isObstacle(it) || isInvisible(it)));
}

/** The caret is in text, with nothing that shows between it and that end of `host`. */
function isAtEdge(host: N, isEnd: boolean): boolean {
  const { startNode, startOffset } = active;
  if (startNode.type !== TEXT || keepsBreaks(startNode) || keepsSpaces(startNode)) return false;
  if (/[^ \t\n\r]/.test(isEnd ? startNode.data.slice(startOffset) : startNode.data.slice(0, startOffset))) return false;
  for (let at = startNode; at !== host; at = at.parent!) {
    for (let it = isEnd ? at.next : at.prev; it !== null; it = isEnd ? it.next : it.prev)
      if (isVisible(it)) return false;
  }
  return true;
}

function leaveContainer(item: N) {
  if (item.first === null) addBreak(item);
  if (isIn(item, definitions) && fitsNowhere(item)) item = rename(item, state.separator);
  fixDisallowedAncestors(item);
}

defineBlockCommand("delete", () => {
  if (!active.collapsed) {
    deleteSelection();
    return true;
  }
  const host = hostOf(active.startNode);
  if (isAtEdge(host!, false)) select(active.startNode, 0);
  else canonicalizeWhitespace(active.startNode, active.startOffset);
  let [node, offset] = [active.startNode, active.startOffset];
  while (true) {
    const before = child(node, offset - 1);
    if (offset === 0 && node !== host && isRemovable(node.prev)) remove(node.prev!);
    else if (isRemovable(before)) {
      remove(before!);
      offset--;
    } else if (node !== host && ((offset === 0 && isInline(node)) || isInvisible(node)))
      [node, offset] = [node.parent!, indexOf(node)];
    else if (isInline(before) && !isUnit(before)) [node, offset] = [before!, lengthOf(before!)];
    else break;
  }
  if (node.type === TEXT) return deleteRange(node, beforeBackspace(node.data, offset), node, offset);
  if (isUnit(child(node, offset - 1)) && !isObstacle(child(node, offset - 1)))
    return deleteRange(node, offset - 1, node, offset);
  if (isInline(node)) return true;
  if (isIn(node, items) && isEditable(node) && node.prev === null && offset === 0) {
    ancestors(node).reverse().forEach(normalizeSublists);
    keepingValues([node], () => splitParent([node]));
    leaveContainer(node);
    return true;
  }
  let [start, startOffset] = [node, offset];
  while (true) {
    if (startOffset > 0) {
      const previous = child(start, startOffset - 1);
      if (isRemovable(previous)) remove(previous!);
      else if (!isObstacle(previous)) break;
      startOffset--;
    } else if (start === host) break;
    else [start, startOffset] = [start.parent!, indexOf(start)];
  }
  if (
    offset === 0 &&
    [node, ...ancestors(node)].some(it => isEditable(it) && shareHost(it, node) && isIndentation(it))
  ) {
    const lines = blockExtend(rangeOf(node, 0, node, 0).$impl);
    contained(lines, it => isEditable(it) && !descendants(it).some(isEditable)).forEach(outdentNode);
    return true;
  }
  const [before, after] = [child(start, startOffset - 1), child(start, startOffset)];
  if (before === null) {
    if (
      node !== host &&
      isBlock(host) &&
      !isHtml(host, "html") &&
      host!.first === host!.last &&
      descendants(host!).every(it => isBlock(it) || isBlockProp(it))
    ) {
      remove(host!.first!);
      collapseBefore(addBreak(host!));
    } else if (isObstacle(after)) remove(after!);
    return true;
  }
  if (isHtml(after, "table") || isIn(after, tableParts)) return true;
  if (isHtml(before, "table")) {
    select(start, startOffset - 1, start, startOffset);
    return true;
  }
  if (
    offset === 0 &&
    (isBreak(before) ? beside(before, false) !== Beside.Content : isBlock(before) && isUnit(before))
  ) {
    remove(before);
    select(node, offset);
    return true;
  }
  while (startOffset > 0 && start.type === ELEMENT) {
    const last = child(start, startOffset - 1)!;
    if (isRemovable(last)) {
      remove(last);
      startOffset--;
    } else if (isObstacle(last)) startOffset--;
    else if (isUnit(last)) break;
    else [start, startOffset] = [last, lengthOf(last)];
  }
  const isAround = contains(blockOf(start), node) && isBlock(node);
  if (start.type === TEXT && start.data.endsWith("\n") && keepsBreaks(start)) {
    const isEmptyLine =
      startOffset > 1 ? start.data[startOffset - 2] === "\n" : beside(start, false) !== Beside.Content;
    if (isAround && isEmptyLine) {
      if (startOffset > 1) core.replaceData(start, startOffset - 1, 1, "");
      else remove(start);
      return true;
    }
    startOffset--;
  } else if (isAround && isBreak(child(start, startOffset - 1)) && !isExtraneousBreak(child(start, startOffset - 1))) {
    remove(child(start, startOffset - 1)!);
    return true;
  }
  return deleteRange(start, startOffset, node, offset, false);
});

defineBlockCommand("forwarddelete", () => {
  if (!active.collapsed) {
    deleteSelection();
    return true;
  }
  const host = hostOf(active.startNode);
  if (isAtEdge(host!, true)) return true;
  canonicalizeWhitespace(active.startNode, active.startOffset);
  let [node, offset] = [active.startNode, active.startOffset];
  while (true) {
    const [after, isAtEnd] = [child(node, offset), offset === lengthOf(node)];
    if (isAtEnd && node !== host && isRemovable(node.next)) remove(node.next!);
    else if (isRemovable(after)) remove(after!);
    else if (node !== host && ((isAtEnd && isInline(node)) || isInvisible(node)))
      [node, offset] = [node.parent!, indexOf(node) + 1];
    else if (isInline(after) && !isUnit(after) && !isBlockProp(after)) [node, offset] = [after!, 0];
    else break;
  }
  if (node.type === TEXT) {
    const isLastLine = node.data[offset] === "\n" && offset + 1 === node.data.length && keepsBreaks(node);
    if (!isLastLine || beside(node, true) !== Beside.Edge)
      return deleteRange(node, offset, node, clusterAt(node.data, offset)[1]);
  }
  let [end, endOffset] = node.type === TEXT ? [node.parent!, indexOf(node) + 1] : [node, offset];
  const next = child(node, offset);
  if (isUnit(next) && !isBlockProp(next) && !isObstacle(next)) return deleteRange(node, offset, node, offset + 1);
  if (isInline(node) && node.type !== TEXT) return true;
  if (isBlockProp(child(end, endOffset))) endOffset++;
  while (true) {
    const after = child(end, endOffset);
    if (after !== null) {
      if (isRemovable(after)) remove(after);
      else if (isObstacle(after)) endOffset++;
      else break;
    } else if (end === host) {
      if (isObstacle(child(end, endOffset - 1))) remove(child(end, endOffset - 1)!);
      return true;
    } else [end, endOffset] = [end.parent!, indexOf(end) + 1];
  }
  const after = child(end, endOffset);
  if (isHtml(child(end, endOffset - 1), "table") || isIn(after, tableParts)) return true;
  if (isHtml(after, "table")) {
    select(end, endOffset, end, endOffset + 1);
    return true;
  }
  if (offset === lengthOf(node) && (isBreak(after) || (isBlock(after) && isUnit(after)))) {
    deleteRange(end, endOffset, end, endOffset + 1);
    select(node, Math.min(offset, lengthOf(node)));
    return true;
  }
  for (let first; (first = child(end, endOffset)) !== null;) {
    if (isRemovable(first)) remove(first);
    else if (isObstacle(first)) endOffset++;
    else if (isUnit(first)) break;
    else [end, endOffset] = [first, 0];
  }
  return deleteRange(node, offset, end, endOffset);
});

function formatOf(node: N): string {
  while (isEditable(node.parent) && shareHost(node, node.parent) && !isIn(node, formattableBlocks)) node = node.parent!;
  return isEditable(node) && isIn(node, formattableBlocks) && !hasBlocks(node) ? node.name : "";
}

defineBlockCommand(
  "formatblock",
  value => {
    const name = asciiLower(value.replace(/^<(.*)>$/, "$1"));
    if (!formattableBlocks.$has(name)) return false;
    const isLine = (it: N) => isIn(it, lineContainers) || isAllowedChild(it, "p") || isIn(it, definitions);
    const nodes = contained(blockExtend(active), it => isEditable(it) && isLine(it) && !hasBlocks(it));
    keepingValues(nodes, () => {
      for (const node of nodes) {
        const isFormat = (it: N) =>
          isIn(it, formattableBlocks) && isEditable(it) && shareHost(it, node) && !hasBlocks(it);
        while (ancestors(node).some(isFormat) && splitParent([node]));
      }
    });
    const isSame = (it: N) => name !== "div" && name !== "p" && isHtml(it, name) && attributeCount(it) === 0;
    while (nodes.length > 0) {
      let run: N[];
      if (isLineContainer(nodes[0])) {
        const container = nodes.shift()!;
        keepingValues((run = children(container)), () => removeKeepingChildren(container));
      } else run = takeRun(nodes, (next, last) => !isLineContainer(next) && !isBreak(last));
      if (run.length > 0) fixDisallowedAncestors(wrap(run, isSame, () => create(name)));
    }
    return true;
  },
  {
    indeterminate: () => new Set(selectedLeaves().map(formatOf)).size > 1,
    value: () => selectedLeaves().slice(0, 1).map(formatOf).join(),
  },
);

defineBlockCommand("indent", () => {
  normalizeSelectedSublists();
  const nodes = contained(
    blockExtend(active),
    it => isEditable(it) && (isAllowedChild(it, "div") || isAllowedChild(it, "ol")),
  );
  const first = nodes.find(isVisible) ?? null;
  if (isHtml(first, "li") && isIn(first!.parent, lists)) {
    let previous = first!.prev;
    while (isInvisible(previous)) previous = previous!.prev;
    normalizeSublists(previous);
  }
  while (nodes.length > 0) indentNodes(takeRun(nodes));
  return true;
});

defineBlockCommand("outdent", () => {
  normalizeSelectedSublists();
  const isUnitOf = (it: N) =>
    !descendants(it).some(isEditable) || isIn(it, lists) || (isHtml(it, "li") && isIn(it.parent, lists));
  for (const nodes = contained(blockExtend(active), it => isEditable(it) && isUnitOf(it)); nodes.length > 0;) {
    if (isIn(nodes[0], lists) || !isIn(nodes[0].parent, lists)) outdentNode(nodes.shift()!);
    else leaveList(takeRun(nodes, next => !isIn(next, lists)));
  }
  return true;
});

/** There is no place for the caret after a break that begins no line. */
function canInsert(): boolean {
  const before = child(active.startNode, active.startOffset - 1);
  if (active.collapsed && isCollapsedBreak(before)) collapseBefore(before!);
  return hostOf(active.startNode) !== null && !isHidden(active.startNode);
}

/** So that what is inserted does not look like what is around it. */
function leaveFormatting() {
  leaveTextAtItsEnds();
  if (active.startNode.type === TEXT) collapseBefore(core.splitText(active.startNode, active.startOffset));
  for (
    let at = active.startNode;
    isModifiable(at) && !isHtml(at, "a") && isEditable(at) && isInline(at);
    at = active.startNode
  ) {
    const after = child(at, active.startOffset);
    if (after === at.first) collapseBefore(at);
    else {
      const copy = core.clone(at, doc, false);
      if (after !== null) insert(copy, at.parent!, at.next);
      while (after !== null && copy.first !== after) move(at.last!, copy, 0);
      collapseAfter(at);
    }
    if (at.first === null) remove(at);
  }
}

function leaveTextAtItsEnds() {
  const { startNode, startOffset } = active;
  if (startNode.type !== TEXT && startNode.type !== COMMENT) return;
  if (startOffset === 0 || startNode.type === COMMENT) collapseBefore(startNode);
  else if (startOffset === startNode.data.length) collapseAfter(startNode);
}

defineBlockCommand("inserthorizontalrule", value => {
  let { startNode, startOffset, endNode, endOffset } = active;
  while (startOffset === 0 && isEditable(startNode)) [startNode, startOffset] = [startNode.parent!, indexOf(startNode)];
  while (endOffset === lengthOf(endNode) && isEditable(endNode))
    [endNode, endOffset] = [endNode.parent!, indexOf(endNode) + 1];
  select(startNode, startOffset, endNode, endOffset);
  deleteSelection(false);
  if (!canInsert()) return true;
  leaveTextAtItsEnds();
  const rule = create("hr");
  if (value !== "") core.setAttr(rule, "id", value);
  insertAtCaret(rule);
  fixDisallowedAncestors(rule);
  collapseAfter(rule);
  return true;
});

const neverInserted = names("script style meta link title base");

defineBlockCommand("inserthtml", value => {
  deleteSelection();
  if (!canInsert()) return true;
  leaveTextAtItsEnds();
  const around = active.startNode.type === ELEMENT ? active.startNode : active.startNode.parent!;
  const fragment = hooks.parseFragment(isIn(around, rowHolders) ? around : create("body"), value);
  for (const node of descendants(fragment)) if (isIn(node, neverInserted)) core.remove(node);
  if (isPlain(around)) return insertText(core.textContent(fragment));
  const [last, inside] = [fragment.last, descendants(fragment)];
  if (last === null) return true;
  if (isBlock(active.startNode)) {
    for (const it of children(active.startNode).slice(active.startOffset))
      if (isEditable(it) && isBlockProp(it)) remove(it);
  }
  if (inside.some(it => isModifiable(it))) leaveFormatting();
  const item = active.startNode;
  if (isHtml(item, "li") && item.first === null && isIn(last, lists) && last.prev === null && last.last !== null) {
    const lastItem = last.last;
    while (last.first !== null) insert(last.first, item.parent!, item);
    remove(item);
    select(lastItem, lengthOf(lastItem));
    return true;
  }
  insertAtCaret(fragment);
  if (isBlock(active.startNode)) keepOpen(active.startNode);
  collapseAfter(last);
  inside.forEach(fixDisallowedAncestors);
  return true;
});

defineBlockCommand("insertimage", value => {
  deleteSelection(true, false);
  if (!canInsert()) return true;
  leaveTextAtItsEnds();
  const { startNode, startOffset } = active;
  if (isBlock(startNode) && startOffset === 0 && startNode.first === startNode.last && isBreak(startNode.first)) {
    remove(startNode.first!);
  }
  const image = create("img");
  if (value !== "") core.setAttr(image, "src", value);
  insertAtCaret(image);
  collapseAfter(image);
  return true;
});

function breakLine() {
  const around = active.startNode.type === ELEMENT ? active.startNode : active.startNode.parent!;
  const usesText = isPlain(around) || !isIn(blockOf(around), preformatted);
  if (usesText && /^(?:preserve|preserve-breaks|break-spaces)$/.test(css(around, "white-space-collapse"))) {
    putText("\n");
    collapse(false);
    return keepLastLine();
  }
  if (!isAllowedChild("br", around)) return;
  leaveTextAtItsEnds();
  const made = create("br");
  insertAtCaret(made);
  if (isCollapsedBreak(made)) addBreak(made.parent!, made.next);
  collapseAfter(made);
  canonicalizeWhitespace(made.parent!, indexOf(made), false);
  canonicalizeWhitespace(made.parent!, indexOf(made) + 1, false);
}

defineBlockCommand("insertlinebreak", () => {
  deleteSelection(true, false);
  if (canInsert()) breakLine();
  return true;
});

defineBlockCommand("insertparagraph", () => {
  deleteSelection();
  const formats = currentOverrides();
  if (canInsert()) splitParagraph();
  restoreFormats(formats);
  return true;
});

function splitParagraph(): true {
  const block = blockOf(active.startNode);
  const isInInlineBlock = [active.startNode, ...ancestors(active.startNode)].some(
    it => isAtomic(it) && contains(block, it),
  );
  if (isPlain(active.startNode) || !shareHost(block, active.startNode) || isInInlineBlock) {
    breakLine();
    return true;
  }
  if (active.startNode.type === TEXT && active.startOffset > 0 && active.startOffset < active.startNode.data.length) {
    core.splitText(active.startNode, active.startOffset);
  }
  const wrappers: N[] = [];
  const styled = firstEquivalentPoint(active.startNode, active.startOffset)[0];
  for (
    let at: N = styled.type === TEXT ? styled.parent! : active.startNode;
    isInline(at) && isEditable(at);
    at = at.parent!
  ) {
    if (at.type === ELEMENT) wrappers.push(at);
  }
  if (wrappers.some(it => isHtml(it, "a"))) wrappers.length = 0;
  leaveTextAtItsEnds();
  const node = active.startNode;
  const isContainer = (it: N) => isBlock(it) && (isLineContainer(it) || (it === block && isIn(it, inlineContainers)));
  let container = node;
  while (!isContainer(container) && isEditable(container.parent) && shareHost(node, container.parent)) {
    container = container.parent!;
  }
  if ((isHtml(container, "p") || isHtml(container, "div")) && isEditable(container)) {
    let outer = container;
    while (!isIn(outer, items) && isEditable(outer.parent)) outer = outer.parent!;
    if (isIn(outer, items)) container = outer;
  }
  if (!isEditable(container) || !shareHost(container, node) || !isContainer(container)) {
    const nodes = contained(blockExtend(active), it => isEditable(it) && isAllowedChild(it, "p")).slice(0, 1);
    if (!isAllowedChild(state.separator, nodes[0]?.parent ?? node)) {
      breakLine();
      return true;
    }
    if (nodes.length === 0) {
      const isEmpty = !childArray(node).some(isVisible);
      for (let count = isEmpty ? 2 : 1; count > 0; count--) {
        insertAtCaret((container = create(state.separator)));
        addBreak(container);
        collapseAfter(container);
      }
      select(container, 0);
      return true;
    }
    while (nodes.at(-1)!.next !== null && isAllowedChild(nodes.at(-1)!.next!, "p")) nodes.push(nodes.at(-1)!.next!);
    const made = wrap(nodes, never, () => create(state.separator));
    if (made === null) return true;
    container = made;
  }
  if (/^(?:address|listing|pre)$/.test(container.name)) {
    breakLine();
    return true;
  }
  if (
    isIn(container, items) &&
    (container.first === null || (container.first === container.last && isBlockProp(container.first)))
  ) {
    splitParent([container]);
    leaveContainer(container);
    return true;
  }
  let [start, offset] = [active.startNode, active.startOffset];
  if (!contains(container, start))
    [start, offset] = [container, comparePoints(start, offset, container, 0) < 0 ? 0 : lengthOf(container)];
  while (offset === 0 && isInline(start)) [start, offset] = [start.parent!, indexOf(start)];
  while (offset === lengthOf(start) && isInline(start)) [start, offset] = [start.parent!, indexOf(start) + 1];
  const rest: R = rangeOf(start, offset, container, lengthOf(container)).$impl;
  const moved = contained(rest, () => true, false);
  const isAtEnd = moved.length === 0 || (moved.length === 1 && isBreak(moved[0]));
  const { name } = container;
  let made = create(
    !isAtEnd ? name : isHeading(name) ? state.separator : name === "dt" ? "dd" : name === "dd" ? "dt" : name,
  );
  copyAttributes(container, made);
  core.removeAttr(made, "id");
  insert(made, container.parent!, container.next);
  if (!rest.collapsed) {
    const fragment = ranges.extractContents(rest);
    for (const it of descendants(fragment)) if (it.type === ELEMENT && !moved.includes(it)) core.removeAttr(it, "id");
    insert(fragment, made, null);
  }
  while (isIn(container.last, notInParagraphs)) container = container.last!;
  while (isIn(made.first, notInParagraphs)) made = made.first!;
  const open = (block: N) => {
    if (childArray(block).some(it => isVisible(it) && !isBlockProp(it))) return block;
    for (const it of children(block)) if (it.type === TEXT || isBlockProp(it)) remove(it);
    for (const wrapper of wrappers.toReversed()) {
      const copy = core.clone(wrapper, doc, false);
      core.removeAttr(copy, "id");
      insert(copy, block, null);
      block = copy;
    }
    addBreak(block);
    return block;
  };
  open(container);
  select(open(made), 0);
  canonicalizeWhitespace(container, lengthOf(container), false);
  canonicalizeWhitespace(made, 0, false);
  return true;
}

/** What is typed at an end of a link is not part of it. */
function leaveLink() {
  let link: Maybe = active.startNode;
  while (isEditable(link) && isInline(link) && !isAnchor(link)) link = link!.parent;
  if (!isAnchor(link) || !isEditable(link) || !isInline(link) || !descendants(link!).some(isFormattable)) return;
  const isEmpty = (range: R) => contained(range, it => isFormattable(it) && !isBlockProp(it), false).length === 0;
  const { startNode, startOffset } = active;
  const [isAtStart, isAtEnd] =
    startNode.type === TEXT ? [startOffset === 0, startOffset === startNode.data.length] : [true, true];
  if (isAtEnd && isEmpty(rangeOf(startNode, startOffset, link!.parent!, indexOf(link!) + 1).$impl))
    collapseAfter(link!);
  else if (isAtStart && isEmpty(rangeOf(link!.parent!, indexOf(link!), startNode, startOffset).$impl))
    collapseBefore(link!);
}

/** Selects what it has inserted. */
function putText(value: string) {
  leaveLink();
  let [node, offset] = [active.startNode, active.startOffset];
  while (isRemovable(child(node, offset - 1)) && child(node, offset - 1)!.type === ELEMENT) offset--;
  if (
    value === " " &&
    !/^(?:preserve|preserve-spaces|break-spaces)$/.test(
      css(node.type === ELEMENT ? node : node.parent!, "white-space-collapse"),
    )
  ) {
    value = "\xa0";
  }
  const [before, after] = [child(node, offset - 1), child(node, offset)];
  if (before?.type === TEXT) [node, offset] = [before, before.data.length];
  else if (after?.type === TEXT) [node, offset] = [after, 0];
  select(node, offset);
  canonicalizeWhitespace(node, offset);
  [node, offset] = [active.startNode, active.startOffset];
  if (node.type === TEXT) {
    const isPlaceholder =
      node.data[offset] === "\n" && offset + 1 === node.data.length && (offset === 0 || node.data[offset - 1] === "\n");
    const drops = isPlaceholder && value !== "\n" && keepsBreaks(node) && beside(node, true) === Beside.Edge;
    core.replaceData(node, offset, +drops, value);
  } else {
    if (value !== "\n" && isBreak(child(node, offset)) && isBlockProp(child(node, offset)))
      remove(child(node, offset)!);
    leaveTextAtItsEnds();
    insertAtCaret((node = core.createText(doc, value)));
    offset = 0;
  }
  select(node, offset, node, offset + value.length);
}

function insertText(value: string): true {
  deleteSelection(true, false);
  value.split(/\r\n|[\r\n]/).forEach((line, index) => {
    if (index > 0) commands.insertparagraph.run("");
    // One at a time, each space is made to show.
    for (const part of line.match(/ |[^ ]+/g) ?? []) {
      if (!canInsert()) return;
      const formats = currentOverrides();
      putText(part);
      restoreFormats(formats);
      canonicalizeEnds(false);
      collapse(false);
    }
  });
  return true;
}
commands.inserttext = { run: insertText };
commands.deleteselection = { run: () => (deleteSelection(), true) };

// ───────────────────────────── entry points ─────────────────────────────

function stateFor(it: Doc): State {
  let found = states.get(it);
  if (found === undefined) states.set(it, (found = new State()));
  return found;
}

/** With the selection as the active range. */
function enter<T>(it: Doc, fallback: T, body: () => T): T {
  const r = selectionOf(it).r;
  if (r === null || core.outOfControl(r.startNode) !== r.startNode) return fallback;
  const outer = [doc, state, active] as const;
  [doc, state, steps] = [it, stateFor(it), 0];
  active = rangeOf(r.startNode, r.startOffset, r.endNode, r.endOffset).$impl;
  computed.$clear();
  try {
    return body();
  } catch (error) {
    if (error !== exhausted) throw error;
    return fallback;
  } finally {
    active.detach();
    [doc, state, active] = outer;
    computed.$clear();
  }
}

const forPlainText = names(
  "delete forwarddelete deleteselection inserttext insertlinebreak insertparagraph inserthtml",
);

function isEnabledNow(name: string): boolean {
  const { startNode, endNode } = active;
  if (hostOf(startNode) === null || hostOf(endNode) === null) return false;
  if (isPlain(startNode) && !forPlainText.$has(name)) return false;
  for (let at: Maybe = ranges.commonAncestor(startNode, endNode); at !== null; at = at.parent)
    if (isHost(at)) return true;
  return false;
}

/** Out of what has no place for a caret. */
function outOfUnits(node: N, offset: number): Point {
  for (let at: Maybe = node; isEditable(at); at = at!.parent) {
    if (isIn(at, replaced) || isIn(at, voids) || isHtml(at, "colgroup")) [node, offset] = [at!.parent!, indexOf(at!)];
  }
  return [node, offset];
}

/** Into the text before it, or else after it. */
function settleCaret() {
  if (!active.collapsed || (active.startNode.type === TEXT && active.startOffset > 0)) return;
  const formats = currentOverrides();
  const places = [firstEquivalentPoint, lastEquivalentPoint].map(find => find(active.startNode, active.startOffset));
  const found = places.find(it => it[0].type === TEXT);
  if (found !== undefined) select(...found);
  restoreFormats(formats);
}

function run(it: Doc, name: string, value: string): boolean {
  if (name === "stylewithcss" || name === "usecss") {
    stateFor(it).usesCss = (asciiLower(value) === "false") === (name === "usecss");
    return true;
  }
  if (name === "defaultparagraphseparator") {
    if (!/^(?:p|div)$/i.test(value)) return false;
    stateFor(it).separator = asciiLower(value);
    return true;
  }
  return enter(it, false, () => {
    if (!isEnabledNow(name)) return false;
    try {
      if (isIn(hostOf(active.startNode), replaced)) return true;
      const { collapsed, startNode } = active;
      select(...outOfUnits(startNode, active.startOffset), ...outOfUnits(active.endNode, active.endOffset));
      const wasInside =
        !collapsed || (startNode !== active.startNode && !isIn(startNode, voids) && !isHtml(startNode, "img"));
      if (active.collapsed && wasInside && name.includes("delete")) return true;
      const result = commands[name].run(value);
      if (forPlainText.$has(name)) settleCaret();
      return result;
    } finally {
      const selection = selectionOf(it);
      const { startNode, startOffset, endNode, endOffset } = active;
      if (selection.backward) selection.select(endNode, endOffset, startNode, startOffset);
      else selection.select(startNode, startOffset, endNode, endOffset);
    }
  });
}

export default {
  run,
  host: (it: Doc): Maybe => enter(it, null, () => hostOf(active.startNode)),
  isEnabled: (it: Doc, name: string) => enter(it, false, () => isEnabledNow(name)),
  isIndeterminate: (it: Doc, name: string) => enter(it, false, () => commands[name]?.indeterminate?.() ?? false),
  state: (it: Doc, name: string) =>
    name === "stylewithcss"
      ? stateFor(it).usesCss
      : commands[name]?.state !== undefined && enter(it, false, () => stateOf(name)),
  value(it: Doc, name: string): string {
    if (name === "defaultparagraphseparator") return stateFor(it).separator;
    return commands[name]?.value === undefined ? "" : enter(it, "", () => valueOf(name));
  },
  /** Whether what is typed next gets a format. */
  hasOverrides: (it: Doc) => stateFor(it).overrides.$size > 0 && enter(it, false, () => overrides().$size > 0),
};
