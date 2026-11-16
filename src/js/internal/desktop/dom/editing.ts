const selectionUnits = { word: 0, sentence: 1, block: 1 };
const shiftedCommands = { z: "redo", v: "pasteandmatchstyle" };
const commandsOfLetters = {
  a: "selectall",
  c: "copy",
  x: "cut",
  v: "paste",
  z: "undo",
  b: "bold",
  i: "italic",
  u: "underline",
};

const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const ranges = require("internal/desktop/dom/range");
const focusing = require("internal/desktop/dom/focus");
const transfer = require("internal/desktop/dom/transfer");
const { styleBits } = require("internal/desktop/dom/html");
const { textControl } = require("internal/desktop/dom/forms");

const { ELEMENT, HTML, TEXT, hooks, indexOf, isHtml, isText, lengthOf, outOfControl, sync } = core;
const { fromEngine, pointId, pointOffset, selectionOf, staticRange } = ranges;
const { editingHost } = focusing;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;
type Selection = $Dom.Selection;
type Point = [node: N, offset: number];
type Span = [startNode: N, startOffset: number, endNode: N, endOffset: number];

const EDITABLE = 4;
const PLAIN_TEXT = 8;
const BLOCK = 2048;
const RTL = 4096;
const KEEPS_SPACES = 8192;
const KEEPS_BREAKS = 32768;
const isMac = process.platform === "darwin";

const enum Direction {
  Forward,
  Backward,
  Left,
  Right,
}
const enum By {
  Character,
  Word,
  Line,
  LineBoundary,
  Paragraph,
  ParagraphBoundary,
  DocumentBoundary,
  Page,
  Nearest,
}

// ───────────────────────────── the selection ─────────────────────────────

/** What a caret in `node` cannot leave. */
function selectionRoot(node: N): N {
  return textControl(core.outOfControl(node))?.editor ?? editingHost(node) ?? node.doc.node;
}

/** What was selected in a control that has lost the focus is kept, but not shown. */
function isInIdleControl(node: N): boolean {
  if (!(node.flags & core.flags.USER_AGENT)) return false;
  const control = core.outOfControl(node);
  return control !== node.doc.focused && textControl(control) !== null;
}

function moveByParagraph(root: N, from: Point, upstream: boolean, direction: Direction, x: number) {
  const start = (point: Point) => movePoint(root, point, false, Direction.Backward, By.ParagraphBoundary).point;
  const own = start(from);
  let at = { point: from, upstream };
  do {
    const next = movePoint(root, at.point, at.upstream, direction, By.Line, x);
    if (ranges.compareComposed(...next.point, ...at.point) === 0) break;
    at = next;
  } while (ranges.compareComposed(...start(at.point), ...own) === 0);
  return at;
}

function movePoint(root: N, [node, offset]: Point, upstream: boolean, direction: Direction, by: By, x = NaN) {
  const moved = sync(root.doc).movePoint(root.id, pointId(node), pointOffset(node, offset), upstream, direction, by, x);
  return moved.length === 0 || moved[0] === 0
    ? { point: [node, offset] as Point, upstream }
    : { point: fromEngine(root.doc, moved[0], moved[1]), upstream: moved[2] === 1 };
}

function caretRect(selection: Selection): number[] {
  const [node, offset] = selection.focus;
  return sync(selection.doc).caretRect(pointId(node), pointOffset(node, offset), selection.upstream);
}

function reveal(selection: Selection) {
  if (selection.r === null) return;
  const [node, offset] = selection.focus;
  sync(selection.doc).revealPoint(pointId(node), pointOffset(node, offset), selection.upstream);
  core.invalidate(selection.doc);
}

function modify(selection: Selection, isExtending: boolean, direction: Direction, by: By, byUser = false) {
  const r = selection.span;
  if (r === null) return;
  const root = selectionRoot(selection.focus[0]);
  const isVertical = by === By.Line || by === By.Page || by === By.Paragraph;
  let from = selection.focus;
  if (!isExtending && !r.collapsed && (by === By.Character || (isMac && by !== By.Word))) {
    const isRtl = (styleBits(root) & RTL) !== 0;
    const toEnd = direction === Direction.Forward || direction === (isRtl ? Direction.Left : Direction.Right);
    from = toEnd ? [r.endNode, r.endOffset] : [r.startNode, r.startOffset];
    if (by === By.Character) return selection.select(from[0], from[1]);
  }
  let x = isVertical ? selection.goalX : NaN;
  if (isVertical && x !== x) x = caretRect(selection)[0];
  const { point, upstream } =
    by === By.Paragraph
      ? moveByParagraph(root, from, selection.upstream, direction, x)
      : movePoint(root, from, selection.upstream, direction, by, x);
  const anchor = isExtending ? selection.anchor : point;
  if (byUser && isExtending && r.collapsed) {
    if (
      ranges.compareComposed(...anchor, ...point) === 0 ||
      !events.fire(outOfControl(anchor[0]), "selectstart", true, true)
    )
      return;
  }
  selection.select(anchor[0], anchor[1], point[0], point[1], upstream);
  selection.goalX = x;
}

hooks.modifySelection = (selection, alter, direction, granularity) => {
  const way = ["forward", "backward", "left", "right"].indexOf(direction);
  const names = ["character", "word", "line", "lineboundary", "paragraph", "paragraphboundary", "documentboundary"];
  const by = names.indexOf(granularity.replace(/^sentence(?:boundary)?$/, "paragraphboundary"));
  if (way >= 0 && by >= 0 && (alter === "move" || alter === "extend")) modify(selection, alter === "extend", way, by);
};

hooks.expandRange = (range, unit) => {
  const by = selectionUnits[unit];
  const root = core.rootOf(range.startNode);
  if (root.scope === null) return;
  if (unit === "document") return range.set(root, 0, root, lengthOf(root));
  if (by === undefined) return;
  const around = (node: N, offset: number) =>
    sync(root.doc).expandPoint(root.id, pointId(node), pointOffset(node, offset), by);
  const [first, last] = [around(range.startNode, range.startOffset), around(range.endNode, range.endOffset)];
  if (first.length === 0 || last.length === 0) return;
  const inTree = ([node, offset]: Point, isEnd: boolean): Point => {
    for (let at; (at = core.rootOf(node)) !== root; node = node.parent!) {
      node = core.hostOf(at);
      offset = indexOf(node) + +isEnd;
    }
    return [node, offset];
  };
  const [start, end] = [
    inTree(fromEngine(root.doc, first[0], first[1]), false),
    inTree(fromEngine(root.doc, last[2], last[3]), true),
  ];
  if (ranges.comparePoints(...start, ...end) <= 0) range.set(...start, ...end);
};

function selectAll(doc: Doc, fromScript: boolean) {
  const selection = selectionOf(doc);
  const control = textControl(doc.focused);
  if (control !== null) return control.select(0, Infinity);
  let root =
    selection.r === null || isInIdleControl(selection.r.startNode)
      ? (editingHost(doc.focused) ?? doc.node)
      : selectionRoot(selection.r.startNode);
  // A caret that is not shown counts as no selection.
  if (
    root !== doc.node &&
    !fromScript &&
    selection.r?.collapsed &&
    (doc.focused === null || !core.contains(root, doc.focused))
  )
    root = doc.node;
  else if (root === doc.node && selection.span !== null && !isInIdleControl(selection.span.startNode))
    root = core.rootOf(selection.span.startNode);
  if (root === doc.node) root = hooks.topModal(doc) ?? core.bodyOf(doc) ?? root;
  if (
    !events.fire(root.type === core.ELEMENT || root === doc.node ? root : core.hostOf(root), "selectstart", true, true)
  )
    return;
  if (root.type !== core.ELEMENT) return selection.select(root, 0, root, lengthOf(root));
  const start = movePoint(root, [root, 0], false, Direction.Forward, By.Nearest).point;
  const end = movePoint(root, [root, lengthOf(root)], false, Direction.Backward, By.Nearest).point;
  selection.select(start[0], start[1], end[0], end[1]);
}

function firstCaretIn(host: N): Point {
  sync(host.doc);
  let block = host;
  for (let at = host.first; at !== null; at = core.following(at, host)) {
    const bits = styleBits(at);
    if (at.type !== ELEMENT) {
      if (isText(at) && (bits & KEEPS_BREAKS ? at.data !== "" : at.data.trim() !== "") && bits & 1)
        return movePoint(host, [at, 0], false, Direction.Forward, By.Nearest).point;
    } else if (!(bits & EDITABLE) || at.name === "hr")
      return core.contains(block, at) ? [block, 0] : [at.parent!, indexOf(at)];
    else if (at.name === "br" && bits & 1) return [at.parent!, indexOf(at)];
    else if (at.ns !== HTML || hasNoCaretInside.test(at.name)) break;
    else if (bits & BLOCK) block = at;
  }
  return movePoint(host, [host, 0], false, Direction.Forward, By.Nearest).point;
}

const hasNoCaretInside = /^(?:audio|button|canvas|embed|iframe|img|input|meter|object|progress|select|textarea|video)$/;

hooks.selectOnFocus = (node, fromKeyboard) => {
  const control = textControl(node);
  const selection = selectionOf(node.doc);
  if (control !== null) {
    sync(node.doc);
    if (fromKeyboard && node.name === "input") control.select(0, Infinity);
    control.showSelection();
  } else if (hooks.isEditingHost(node)) {
    if (selection.r !== null && core.contains(node, selection.r.startNode)) return;
    selection.select(...firstCaretIn(node));
  }
};

hooks.revealCaret = node => {
  const selection = selectionOf(node.doc);
  if (selection.r === null || (textControl(node) === null && editingHost(selection.r.startNode) !== node)) return false;
  reveal(selection);
  return node.name !== "input";
};

// ───────────────────────────── undo ─────────────────────────────

type Step = { records: any[]; before: Span; after: Span; inputType: string };

/** What the user's edits did to the tree, as mutation records. */
class History {
  undos: Step[] = [];
  redos: Step[] = [];
}
const histories = new WeakMap<N, History>();

function spanOf(selection: Selection): Span {
  const { startNode, startOffset, endNode, endOffset } = selection.r!;
  return [startNode, startOffset, endNode, endOffset];
}

function record(host: N, change: () => void): any[] {
  const observer: any = { records: [], transient: [], serial: 0, callback() {} };
  const { doc } = host;
  const list = (core.rare(host).observers ??= []);
  const flags = host.flags & core.flags.OBSERVED;
  const { observed, observedOldValues } = doc;
  const observation = new core.Observation(observer, 7, 6, true, null);
  list.push(observation);
  host.flags |= core.flags.OBSERVED;
  doc.observed = doc.observedOldValues = 7;
  try {
    change();
  } finally {
    list.splice(list.indexOf(observation), 1);
    host.flags = (host.flags & ~core.flags.OBSERVED) | flags;
    doc.observed = observed;
    doc.observedOldValues = observedOldValues;
  }
  return observer.records.splice(0);
}

function revert(records: any[]) {
  for (const { type, target, name, oldValue, added, removed, next } of records.toReversed()) {
    if (type === 4) core.replaceData(target, 0, target.data.length, oldValue);
    else if (type === 2) oldValue === null ? core.removeAttr(target, name) : core.setAttr(target, name, oldValue);
    else {
      for (const node of added ?? []) if (node.parent === target) core.remove(node);
      for (const node of removed ?? []) core.insert(node, target, next?.parent === target ? next : null);
    }
  }
}

function travel(host: N, isUndo: boolean): boolean {
  const history = histories.get(host);
  const step = history?.[isUndo ? "undos" : "redos"].pop();
  if (step === undefined) return false;
  const records = record(host, () => revert(step.records));
  history![isUndo ? "redos" : "undos"].push({ records, before: step.after, after: step.before, inputType: "" });
  const [startNode, startOffset, endNode, endOffset] = step.before;
  if (!core.contains(host, startNode) || !core.contains(host, endNode)) return true;
  const within = (node: N, offset: number) => Math.min(offset, lengthOf(node));
  selectionOf(host.doc).select(startNode, within(startNode, startOffset), endNode, within(endNode, endOffset));
  return true;
}

// ───────────────────────────── commands ─────────────────────────────

/** The text control or the editing host that the selection is in. */
function editTarget(doc: Doc): N | null {
  const control = textControl(doc.focused);
  if (control !== null) return control.isMutable() && styleBits(control.node, 1) ? control.node : null;
  const r = selectionOf(doc).r;
  if (r === null || isInIdleControl(r.startNode)) return null;
  return editingHost(r.startNode) ?? (doc.page?.isExecutingCommand ? rich().host(doc) : null);
}

/** The same, if the keys go there. */
function typingTarget(doc: Doc): N | null {
  const target = editTarget(doc);
  const { focused } = doc;
  return target !== null && (doc.designMode || target === focused || editingHost(focused) === target) ? target : null;
}

type Details = { data?: string | null; dataTransfer?: object | null; isComposing?: boolean };

function fireBeforeInput(target: N, inputType: string, details: Details, span: Span | null): boolean {
  if (!events.isListenedTo("beforeinput")) return true;
  const init = {
    ...details,
    inputType,
    bubbles: true,
    composed: true,
    cancelable: inputType !== "insertCompositionText",
    view: target.doc.page!.window,
    staticRanges: span === null || textControl(target) !== null ? [] : [staticRange(...span)],
  };
  const proceeds = events.dispatch(target, new events.InputEvent("beforeinput", init));
  init.staticRanges.length = 0;
  return proceeds;
}

function fireInput(target: N, inputType: string, details: Details) {
  const init = { ...details, inputType, bubbles: true, composed: true, view: target.doc.page!.window };
  events.dispatch(target, new events.InputEvent("input", init));
}

let commands: (typeof import("./commands"))["default"] | undefined;
const rich = () => (commands ??= require("internal/desktop/dom/commands"));

const spaces = /[\t\n\r \xa0]/;
const newlines = /[\n\r]/;

/** Inside of one text node, where nothing but that text changes. */
function isSimple([node, start, endNode, end]: Span, text: string): boolean {
  if (node !== endNode || node.type !== TEXT || commands?.hasOverrides(node.doc)) return false;
  const { data } = node;
  const around = (data[start - 1] ?? " ") + text + (data[end] ?? " ");
  if (start === 0 || end === data.length) {
    if (end - start === data.length || core.closestHtml(node, "a") !== null) return false;
  }
  if (!(styleBits(node) & KEEPS_SPACES)) return !spaces.test(around);
  return !newlines.test(around) && (end < data.length || node.next?.name !== "br");
}

function change(host: N, inputType: string, body: () => boolean): { result: boolean; hasChanged: boolean } {
  const selection = selectionOf(host.doc);
  const before = spanOf(selection);
  let result = false;
  const records = record(host, () => void (result = body()));
  if (records.length > 0 && selection.r !== null)
    remember(host, { records, before, after: spanOf(selection), inputType });
  core.react();
  return { result, hasChanged: records.length > 0 };
}

/**
 * Replaces what `span` returns. `text` goes into a text control, and `command` gets `value` in editable content.
 * `silent` is for `execCommand`, which fires no `beforeinput`.
 */
function replace(
  doc: Doc,
  inputType: string,
  details: Details,
  span: (selection: Selection, root: N) => Span,
  text: string,
  command: string,
  silent = false,
  value = text,
): boolean {
  const selection = selectionOf(doc);
  let target = editTarget(doc);
  if (target === null || selection.r === null) return false;
  if (
    !silent &&
    !fireBeforeInput(target, inputType, details, targetOf(span(selection, selectionRoot(selection.r.startNode))))
  ) {
    return true;
  }
  if ((target = editTarget(doc)) === null || selection.r === null) return true;
  const replaced = span(selection, selectionRoot(selection.r.startNode));
  const isDeletion = command.includes("delete");
  const control = textControl(target);
  if (control !== null) {
    const offset = (node: N, at: number) => (isText(node) ? at : at === 0 ? 0 : control.text.length);
    const [start, end] = [offset(replaced[0], replaced[1]), offset(replaced[2], replaced[3])];
    const allowed = inputType === "insertCompositionText" ? text : control.filter(text, start, end);
    if (allowed === "" && start === end) return true;
    control.edit(start, end, allowed, inputType);
    core.react();
  } else {
    const { result, hasChanged } = change(target, inputType, () => {
      if ((isDeletion ? replaced[1] < replaced[3] : command === "inserttext") && isSimple(replaced, text)) {
        core.replaceData(replaced[0], replaced[1], replaced[3] - replaced[1], text);
        selection.select(replaced[0], replaced[1] + text.length);
        return true;
      }
      if (command !== "delete" && command !== "forwarddelete") selection.select(...replaced);
      return rich().run(doc, command, value);
    });
    if (!result || (isDeletion && !hasChanged)) return result;
  }
  fireInput(target, inputType, details);
  reveal(selection);
  return true;
}

/** The last or the first of the positions that the caret shows in the same place. */
function outermost(root: N, node: N, offset: number, isForward: boolean): Point {
  const isBlock = (it: N) => it.type === ELEMENT && (styleBits(it) & BLOCK) !== 0;
  const isBlank = (it: N) =>
    isText(it) ? it.data.trim() === "" && !(styleBits(it) & KEEPS_BREAKS) : it.type !== ELEMENT;
  const skip = (it: N | null, forward: boolean) => {
    while (it !== null && isBlank(it)) it = forward ? it.next : it.prev;
    return it;
  };
  let found: Point = [node, offset];
  while (true) {
    if (isText(node) && offset !== (isForward ? node.data.length : 0)) return [node, offset];
    const after = core.childAt(node, offset);
    const before = after === null ? node.last : after.prev;
    const next = skip(isForward ? after : before, isForward);
    if (next === null) {
      if (node === root || node.parent === null || isBlock(node)) return found;
      [node, offset] = [node.parent, indexOf(node) + +isForward];
      continue;
    }
    if (isBlock(next)) {
      const other = skip(isForward ? before : after, !isForward);
      if (next.first === null || isText(found[0]) || (other !== null && !isBlock(other))) return found;
    } else if (next.type === ELEMENT && (next.first === null || !(styleBits(next) & EDITABLE))) {
      return [node, indexOf(next) + +!isForward];
    }
    [node, offset] = [next, isForward ? 0 : lengthOf(next)];
    if (isText(node)) found = [node, offset];
  }
}

/** With its ends where the first and the last of what it shows are. */
function targetOf(span: Span): Span {
  if (isText(span[0]) && span[0] === span[2]) return span;
  const root = selectionRoot(span[0]);
  const keepsEnd = span[2].type === ELEMENT && span[3] === 0 && (styleBits(span[2]) & BLOCK) !== 0;
  const start = outermost(root, span[0], span[1], true);
  const end: Point = keepsEnd ? [span[2], 0] : outermost(root, span[2], span[3], false);
  return ranges.compareComposed(...start, ...end) > 0 ? span : [...start, ...end];
}

function remember(host: N, step: Step) {
  let history = histories.get(host);
  if (history === undefined) histories.set(host, (history = new History()));
  const last = history.undos.at(-1);
  history.redos = [];
  if (last?.inputType === step.inputType && /^(?:insertText|insertCompo|deleteContent)/.test(step.inputType)) {
    last.records.push(...step.records);
    last.after = step.after;
  } else if (history.undos.push(step) > 200) history.undos.shift();
}

function insertText(doc: Doc, text: string, inputType = "insertText", silent = false): boolean {
  return replace(doc, inputType, { data: text }, spanOf, text, "inserttext", silent);
}

function insertBreak(doc: Doc, isParagraph: boolean, silent = false): boolean {
  const target = editTarget(doc);
  if (target === null || target.name === "input") return false;
  if (textControl(target) !== null || styleBits(target) & PLAIN_TEXT) isParagraph = false;
  const inputType = isParagraph ? "insertParagraph" : "insertLineBreak";
  return replace(doc, inputType, {}, spanOf, "\n", inputType.toLowerCase(), silent);
}

/** Backspace takes a combining mark off a letter, but the whole of an emoji. */
function beforeBackspace(text: string, offset: number): number {
  const isMark = /[\p{M}\u1160-\u11ff]/u.test(text[offset - 1]) && !/[︀-️⃣]/.test(text[offset - 1]);
  return isMark ? offset - 1 : -1;
}

function deleteBy(doc: Doc, isForward: boolean, by: By, silent = false): boolean {
  const isCollapsed = selectionOf(doc).r?.collapsed;
  const unit = !isCollapsed ? "Content" : (["Content", "Word", "", "SoftLine"][by] ?? "HardLine");
  const span = (selection: Selection, root: N): Span => {
    if (!selection.r!.collapsed) return spanOf(selection);
    const from = selection.focus;
    const move = (by: By) =>
      movePoint(root, from, selection.upstream, isForward ? Direction.Forward : Direction.Backward, by).point;
    const mark =
      !isForward && by === By.Character && from[1] > 0 && isText(from[0]) ? beforeBackspace(from[0].data, from[1]) : -1;
    let to: Point = mark >= 0 ? [from[0], mark] : move(by);
    if (by > By.Word && ranges.comparePoints(...from, ...to) === 0) to = move(By.Character);
    return ranges.comparePoints(...from, ...to) < 0 ? [...from, ...to] : [...to, ...from];
  };
  const command = by !== By.Character ? "deleteselection" : isForward ? "forwarddelete" : "delete";
  return replace(doc, `delete${unit}${isForward ? "Forward" : "Backward"}`, {}, span, "", command, silent);
}

function history(doc: Doc, isUndo: boolean, silent = false): boolean {
  const target = editTarget(doc);
  const inputType = isUndo ? "historyUndo" : "historyRedo";
  if (target === null) return false;
  if (!silent && !fireBeforeInput(target, inputType, {}, null)) return true;
  if (!(textControl(target)?.travel(isUndo) ?? travel(target, isUndo))) return false;
  fireInput(target, inputType, {});
  reveal(selectionOf(doc));
  return true;
}

const formats: Record<string, string | undefined> = {
  __proto__: null as any,
  backcolor: "formatBackColor",
  bold: "formatBold",
  createlink: "insertLink",
  fontname: "formatFontName",
  fontsize: "",
  forecolor: "formatFontColor",
  formatblock: "",
  hilitecolor: "formatBackColor",
  indent: "formatIndent",
  inserthorizontalrule: "insertHorizontalRule",
  insertimage: "",
  insertorderedlist: "insertOrderedList",
  insertunorderedlist: "insertUnorderedList",
  italic: "formatItalic",
  justifycenter: "formatJustifyCenter",
  justifyfull: "formatJustifyFull",
  justifyleft: "formatJustifyLeft",
  justifyright: "formatJustifyRight",
  outdent: "formatOutdent",
  removeformat: "formatRemove",
  strikethrough: "formatStrikeThrough",
  subscript: "formatSubscript",
  superscript: "formatSuperscript",
  underline: "formatUnderline",
  unlink: "",
};

function format(doc: Doc, name: string, value: string, silent: boolean): boolean {
  const host = editTarget(doc);
  const inputType = formats[name]!;
  if (host === null || textControl(host) !== null || !rich().isEnabled(doc, name)) return false;
  if (!silent && !fireBeforeInput(host, inputType, {}, targetOf(spanOf(selectionOf(doc))))) return true;
  if (selectionOf(doc).r === null) return true;
  const { result } = change(host, inputType, () => rich().run(doc, name, value));
  if (result) fireInput(host, inputType, name === "createlink" ? { data: value } : {});
  return result;
}

// ───────────────────────────── the clipboard ─────────────────────────────

function clipboardTarget(doc: Doc): N | null {
  const start = selectionOf(doc).r?.startNode;
  if (start === undefined) return doc.focused ?? core.bodyOf(doc) ?? core.documentElement(doc);
  return core.outOfControl(start.type === ELEMENT ? start : (start.parent ?? start));
}

function fireClipboard(doc: Doc, type: string, clipboardData: InstanceType<typeof transfer.DataTransfer>): boolean {
  const target = clipboardTarget(doc);
  const init = { bubbles: true, cancelable: true, composed: true, clipboardData };
  return target === null || events.dispatch(target, new events.ClipboardEvent(type, init));
}

const structural = /^(?:ol|ul|dl|pre|table|thead|tbody|tfoot|tr|math)$/;

/** With the elements that it would not look or mean the same without. */
function markupOf({ r }: Selection): string {
  let contents = ranges.cloneContents(r!)!;
  const root = selectionRoot(r!.startNode);
  for (let at: N | null = ranges.commonAncestor(r!.startNode, r!.endNode); at !== null && at !== root; at = at.parent) {
    if (at.type !== ELEMENT) continue;
    if (styleBits(at) & BLOCK && !structural.test(at.name)) break;
    const copy = core.clone(at, at.doc, false);
    core.insert(contents, copy, null);
    contents = copy;
  }
  return contents.type === ELEMENT ? hooks.serializeOuter(contents) : hooks.serializeInner(contents);
}

function putSelection(doc: Doc, store: InstanceType<typeof transfer.Store>): boolean {
  const selection = selectionOf(doc);
  const text = selection.text();
  if (text === "") return false;
  store.set("text/plain", text.replaceAll("\xa0", " "));
  if (textControl(core.outOfControl(selection.r!.startNode)) === null && selection.composed === null)
    store.set("text/html", markupOf(selection));
  return true;
}

function copy(doc: Doc, isCut: boolean, silent: boolean): boolean {
  const data = new transfer.DataTransfer();
  const proceeds = fireClipboard(doc, isCut ? "cut" : "copy", data);
  data.$impl.mode = transfer.DISABLED;
  if (!proceeds) {
    if (data.$impl.items.length > 0) transfer.writeClipboard(doc.page!, data.$impl);
    return true;
  }
  const store = new transfer.Store();
  if ((isCut && editTarget(doc) === null) || !putSelection(doc, store)) return false;
  transfer.writeClipboard(doc.page!, store);
  return !isCut || replace(doc, "deleteByCut", {}, spanOf, "", "deleteselection", silent);
}

function insertTransfer(
  doc: Doc,
  data: InstanceType<typeof transfer.DataTransfer>,
  inputType: string,
  asText: boolean,
) {
  const target = editTarget(doc);
  if (target === null) return false;
  const text = data.getData("text/plain");
  const html = asText || styleBits(target) & PLAIN_TEXT ? "" : data.getData("text/html");
  const details = textControl(target) !== null ? { data: text } : { dataTransfer: data };
  if (html === "") return replace(doc, inputType, details, spanOf, text, "inserttext");
  return replace(doc, inputType, details, spanOf, text, "insertpasted", false, html);
}

/** For the middle button on Linux. */
function offerSelection(doc: Doc) {
  const selection = selectionOf(doc);
  if (selection.r === null || selection.span!.collapsed || textControl(doc.focused)?.type === "password") return;
  const text = selection.text();
  if (text !== "") doc.page!.host.clipboard?.writeText(text.replaceAll("\xa0", " "), "selection");
}

function paste(doc: Doc, asText: boolean, kind?: string): boolean {
  if (kind !== undefined && editTarget(doc) === null) return false;
  const data = transfer.readClipboard(doc.page!, kind);
  if (asText) data.$impl.items = data.$impl.items.filter(item => item.type !== "text/html");
  const done = !fireClipboard(doc, "paste", data) || insertTransfer(doc, data, "insertFromPaste", asText);
  data.$impl.mode = transfer.DISABLED;
  return done;
}

const settings = new Set(["stylewithcss", "usecss", "defaultparagraphseparator"]);
const others = new Set(
  core.splitTokens(`copy cut paste pasteandmatchstyle selectall unselect undo redo delete forwarddelete inserttext
  inserthtml insertlinebreak insertparagraph`),
);
const isSupported = (name: string) => others.$has(name) || settings.$has(name) || formats[name] !== undefined;

/** `name` is in lowercase. */
function execute(doc: Doc, name: string, value: string, fromScript: boolean): boolean {
  switch (name) {
    case "copy":
    case "cut":
      return copy(doc, name === "cut", fromScript) || (fromScript && name === "copy");
    case "paste":
    case "pasteandmatchstyle":
      return !fromScript && paste(doc, name !== "paste");
    case "selectall":
      selectAll(doc, fromScript);
      return true;
    case "unselect":
      selectionOf(doc).clear();
      return true;
    case "undo":
    case "redo":
      return history(doc, name === "undo", fromScript);
    case "delete":
    case "forwarddelete":
      return deleteBy(doc, name !== "delete", By.Character, fromScript);
    case "inserttext":
      return insertText(doc, value, "insertText", fromScript);
    case "inserthtml": {
      const text = core.textContent(hooks.parseFragment(core.createPlainElement(doc, "body", HTML), value));
      const isText = textControl(doc.focused) !== null;
      return replace(
        doc,
        isText ? "insertText" : "",
        isText ? { data: text } : {},
        spanOf,
        text,
        name,
        fromScript,
        value,
      );
    }
    case "insertlinebreak":
    case "insertparagraph":
      return insertBreak(doc, name === "insertparagraph", fromScript);
  }
  if (settings.$has(name)) return rich().run(doc, name, value);
  return formats[name] !== undefined && format(doc, name, value, fromScript);
}

function isEnabled(doc: Doc, name: string): boolean {
  if (name === "copy") return selectionOf(doc).text() !== "";
  if (settings.$has(name) || name === "selectall" || name === "unselect") return true;
  const target = isSupported(name) ? editTarget(doc) : null;
  if (target === null) return false;
  if (formats[name] !== undefined) return rich().isEnabled(doc, name);
  if (name === "cut") return selectionOf(doc).text() !== "";
  if (name !== "undo" && name !== "redo") return true;
  return (textControl(target) ?? histories.get(target))?.[name + "s"].length > 0;
}

// ───────────────────────────── keys ─────────────────────────────

function movement({ key, altKey, ctrlKey, metaKey }: any): [Direction, By] | undefined {
  const byWord = isMac ? altKey : ctrlKey;
  if (!isMac && (altKey || metaKey)) return;
  switch (key) {
    case "ArrowLeft":
    case "ArrowRight":
      return [
        key === "ArrowLeft" ? Direction.Left : Direction.Right,
        byWord ? By.Word : metaKey ? By.LineBoundary : By.Character,
      ];
    case "ArrowUp":
    case "ArrowDown":
      return [
        key === "ArrowUp" ? Direction.Backward : Direction.Forward,
        metaKey ? By.DocumentBoundary : !byWord ? By.Line : isMac ? By.ParagraphBoundary : By.Paragraph,
      ];
    case "Home":
    case "End":
      if (isMac) return;
      return [key === "Home" ? Direction.Backward : Direction.Forward, ctrlKey ? By.DocumentBoundary : By.LineBoundary];
    case "PageUp":
    case "PageDown":
      return isMac ? undefined : [key === "PageUp" ? Direction.Backward : Direction.Forward, By.Page];
  }
  if (!isMac || !ctrlKey || metaKey) return;
  return {
    a: [Direction.Backward, By.ParagraphBoundary],
    e: [Direction.Forward, By.ParagraphBoundary],
    b: [Direction.Backward, By.Character],
    f: [Direction.Forward, By.Character],
    p: [Direction.Backward, By.Line],
    n: [Direction.Forward, By.Line],
  }[key.toLowerCase()] as [Direction, By] | undefined;
}

function shortcut({ key, code, shiftKey, altKey, ctrlKey, metaKey }: any): string | undefined {
  if (!isMac && key === "Insert") return shiftKey ? "paste" : ctrlKey ? "copy" : undefined;
  if (!isMac && key === "Delete" && shiftKey) return "cut";
  if (isMac ? !metaKey || ctrlKey : !ctrlKey || altKey || metaKey) return;
  const letter = /^[a-z]$/i.test(key) ? key.toLowerCase() : code.replace(/^Key/, "").toLowerCase();
  if (shiftKey) return shiftedCommands[letter];
  if (letter === "y") return isMac ? undefined : "redo";
  return commandsOfLetters[letter];
}

/** The default action of `keydown`. */
function handleKey(doc: Doc, event: any): boolean {
  const command = shortcut(event);
  // A menu item with the same shortcut would fire the clipboard event again.
  if (command !== undefined) return execute(doc, command, "", false) || /^(?:copy|cut|paste)/.test(command);
  const selection = selectionOf(doc);
  const { key, ctrlKey, altKey, metaKey, shiftKey } = event;
  if (selection.r === null || isInIdleControl(selection.r.startNode)) return false;
  const hasCaret = typingTarget(doc) !== null || textControl(doc.focused) !== null;
  if (hasCaret && (key === "Backspace" || key === "Delete")) {
    return deleteBy(
      doc,
      key === "Delete",
      (isMac ? altKey : ctrlKey) ? By.Word : metaKey ? By.LineBoundary : By.Character,
    );
  }
  if (isMac && hasCaret && ctrlKey && !metaKey && /^[dhk]$/.test(key)) {
    return deleteBy(doc, key !== "h", key === "k" ? By.ParagraphBoundary : By.Character);
  }
  const move = movement(event);
  if (move === undefined || !(hasCaret || (shiftKey && !selection.span!.collapsed))) return false;
  modify(selection, shiftKey, move[0], move[1], true);
  reveal(selection);
  return true;
}

// ───────────────────────────── input methods ─────────────────────────────

/** What is being composed is `length` code units of `node`, from `start`. */
type Composition = { target: N; node: N | null; start: number; length: number; text: string };
declare global {
  namespace $Dom {
    type Composition = CompositionImpl;
  }
}
type CompositionImpl = Composition;

function fireComposition(target: N, type: string, data: string) {
  const init = { bubbles: true, cancelable: type === "compositionstart", composed: true, data };
  events.dispatch(target, new events.CompositionEvent(type, { ...init, view: target.doc.page!.window }));
}

/** The offsets of an input method are in the text node that has the caret. */
function selectForInputMethod(doc: Doc, range?: [number, number]) {
  const node = selectionOf(doc).r?.endNode;
  if (!range || node === undefined || !isText(node) || range[1] > node.data.length) return;
  selectionOf(doc).select(node, range[0], node, range[1]);
}

function compose(page: Page, text: string, inside?: [number, number], range?: [number, number]) {
  const { doc } = page;
  const selection = selectionOf(doc);
  if (page.composition === null) {
    const target = editTarget(doc);
    if (target === null || text === "") return;
    selectForInputMethod(doc, range);
    page.composition = { target, node: null, start: 0, length: 0, text: "" };
    fireComposition(target, "compositionstart", selection.text());
  }
  const it = page.composition;
  if (it === null) return;
  fireComposition(it.target, "compositionupdate", (it.text = text));
  const span = (selection: Selection): Span =>
    it.node !== null && it.node.scope !== null && it.start + it.length <= it.node.data.length
      ? [it.node, it.start, it.node, it.start + it.length]
      : spanOf(selection);
  const before = span(selection);
  if (before[0] === before[2] && isText(before[0]) && textControl(it.target) === null && text !== "") {
    const details = { data: text, isComposing: true };
    fireBeforeInput(it.target, "insertCompositionText", details, before);
    const [node, start, , end] = span(selection);
    if (isText(node)) {
      const records = record(it.target, () => core.replaceData(node, start, end - start, text));
      selection.select(node, start + text.length);
      remember(it.target, { records, before, after: spanOf(selection), inputType: "insertCompositionText" });
      noteComposition(it, selection, inside);
      return fireInput(it.target, "insertCompositionText", details);
    }
  }
  replace(doc, "insertCompositionText", { data: text, isComposing: true }, span, text, "inserttext");
  noteComposition(it, selection, inside);
}

function noteComposition(it: Composition, selection: Selection, inside?: [number, number]) {
  const r = selection.r;
  it.node = r !== null && isText(r.endNode) && r.endOffset >= it.text.length ? r.endNode : null;
  if (it.node === null) return;
  it.start = r!.endOffset - it.text.length;
  it.length = it.text.length;
  if (inside) selection.select(it.node, it.start + inside[0], it.node, it.start + inside[1]);
  reveal(selection);
}

function endComposition(page: Page) {
  const it = page.composition;
  if (it === null) return;
  page.composition = null;
  core.invalidate(page.doc);
  fireComposition(it.target, "compositionend", it.text);
}

/** Text that was typed. */
function type(page: Page, text: string, range?: [number, number]) {
  if (page.composition !== null) return compose(page, text);
  const target = typingTarget(page.doc);
  if (target === null) return;
  selectForInputMethod(page.doc, range);
  if (!fireBeforeInput(target, "insertText", { data: text }, targetOf(spanOf(selectionOf(page.doc))))) return;
  if (events.isListenedTo("textInput")) {
    const init = { bubbles: true, cancelable: true, composed: true, view: page.window, data: text };
    if (!events.dispatch(target, new events.TextEvent("textInput", init))) return;
  }
  insertText(page.doc, text, "insertText", true);
}

/** What `surface.ime` takes. */
/** What the library was last told. */
class InputMethodState {
  enabled: boolean | null = null;
  text = "";
  start = 0;
  end = 0;
  composedStart = -1;
  composedEnd = -1;
  upstream = false;
  node: N | null = null;
  layoutVersion = -1;
  rect: number[] = [];

  /** Something else has told it something. */
  forget() {
    this.enabled = null;
  }
}

/** Whether something has changed. */
function updateInputMethod(page: Page): boolean {
  const { doc, composition, inputMethodState: state } = page;
  if (page.container?.isFocused() === false) return false;
  const id = page.container?.surface ?? page.surface;
  const selection = selectionOf(doc);
  const r = selection.r;
  if (r === null || typingTarget(doc) === null || textControl(doc.focused)?.type === "password") {
    if (state.enabled === false) return false;
    state.enabled = false;
    state.node = null;
    page.native.send("surface.ime", { id, enabled: false });
    return true;
  }
  const hasText = isText(r.endNode);
  const text = hasText ? r.endNode.data : "";
  const start = r.startNode === r.endNode ? r.startOffset : 0;
  const end = r.endOffset;
  const composedStart = composition?.node ? composition.start : -1;
  const composedEnd = composition?.node ? composition.start + composition.length : -1;
  const isSame =
    state.enabled === true &&
    state.node === r.endNode &&
    state.start === start &&
    state.end === end &&
    state.upstream === selection.upstream &&
    state.composedStart === composedStart &&
    state.composedEnd === composedEnd &&
    state.text === text;
  if (isSame && state.layoutVersion === page.layoutVersion) return false;
  state.layoutVersion = page.layoutVersion;
  const rect = caretRect(selection);
  if (isSame && rect.every((it, i) => it === state.rect[i])) return false;
  state.enabled = true;
  state.node = r.endNode;
  state.start = start;
  state.end = end;
  state.upstream = selection.upstream;
  state.composedStart = composedStart;
  state.composedEnd = composedEnd;
  state.text = text;
  state.rect = rect;
  const [x = 0, y = 0, width = 0, height = 0] = rect.map(it => it * page.zoom);
  const [left, top] = page.offsetInTop();
  page.native.send("surface.ime", {
    id,
    enabled: true,
    text,
    selection: hasText ? [start, end] : [0, 0],
    composing: composedStart < 0 ? null : [composedStart, composedEnd],
    rect: { x: x + left * page.zoom, y: y + top * page.zoom, width, height },
  });
  return true;
}

export default {
  isInIdleControl,
  InputMethodState,
  updateInputMethod,
  commands: rich,
  compose,
  deleteDragged: (doc: Doc) => replace(doc, "deleteByDrag", {}, spanOf, "", "deleteselection"),
  editTarget,
  endComposition,
  execute,
  handleKey,
  insertBreak,
  insertText,
  insertTransfer,
  isEnabled,
  isSupported,
  offerSelection,
  paste,
  putSelection,
  reveal,
  selectionRoot,
  type,
  typingTarget,
};
