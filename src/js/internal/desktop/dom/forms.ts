const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const nodes = require("internal/desktop/dom/node");
const html = require("internal/desktop/dom/html");
const focusing = require("internal/desktop/dom/focus");
const interactive = require("internal/desktop/dom/interactive");
const loader = require("internal/desktop/dom/loader");
const { styleOf } = require("internal/desktop/dom/cssom");
const { customStates } = require("internal/desktop/dom/custom");
const { opaqueRange, selectionOf } = require("internal/desktop/dom/range");
const { parseColor } = require("internal/desktop/dom/engine");
const { FileList, fileList } = require("internal/desktop/dom/transfer");

const { ELEMENT, HTML, asciiLower, domError, expose, flags, getAttr, hasAttr, hooks, isHtml, react, same } = core;
const { setAttr, setState, splitTokens, states, wrap, wrapOrNull } = core;
const { define, parseInteger } = html;
const { kList } = nodes;
const { CONNECTED, CUSTOM, HOST } = flags;
const NativeFormData = core.NativeFormData;

type N = $Dom.N;
type Doc = $Dom.Doc;

function part(host: N, parent: N, pseudo: string, tag = "div"): N {
  const made = core.createPlainElement(host.doc, tag, HTML);
  core.setPseudo(made, pseudo, host);
  return core.append(parent, made);
}

function textIn(parent: N): N {
  return core.append(parent, core.createText(parent.doc, ""));
}

function setText(text: N, data: string) {
  if (text.data !== data) core.replaceData(text, 0, text.data.length, data);
}

function clearShadow(node: N): N {
  const root = node.rare!.shadow!;
  while (root.first !== null) core.remove(root.first, true);
  return root;
}

/** Its looks and its validity are brought up to date before the engine is next asked something. */
function dirty(node: N | null) {
  if (node === null || node.doc.page === null) return;
  node.doc.dirtyControls.$add(node);
  node.doc.needsSync = true;
  core.invalidate(node.doc);
}

function fireInput(node: N) {
  events.fire(node, "input", true, false, true);
}

function userChanged(node: N) {
  control(node).wasEdited = true;
  dirty(node);
  fireInput(node);
  events.fire(node, "change", true);
}

// ───────────────────────────── what controls share ─────────────────────────────

class Control {
  node: N;
  type = "";
  customError = "";
  /** For `:user-invalid`. */
  wasEdited = false;
  isText = false;

  constructor(node: N) {
    this.node = node;
  }
  /** The members of `ValidityState` that are true, but for `customError`. */
  errors(): string[] {
    return [];
  }
  isBarred(): boolean {
    return false;
  }
  reset() {}
  render() {}
  entries(_add: (name: string, value: unknown) => void, _submitter: N | null) {}
}

function control(node: N): Control {
  return node.name === "object" ? same(node, "control", () => new Barred(node)) : node.x;
}

const listedNames = new Set(splitTokens("button fieldset input object output select textarea"));
const canBeDisabled = new Set(splitTokens("button fieldset input optgroup option select textarea"));
const labelableNames = new Set(splitTokens("button input meter output progress select textarea"));
const isFormCustom = (node: N) => (node.flags & CUSTOM) !== 0 && node.rare!.definition!.formAssociated;
const isListed = (node: N) => node.ns === HTML && (listedNames.$has(node.name) || isFormCustom(node));

function isLabelable(node: N): boolean {
  if (node.ns !== HTML) return false;
  return labelableNames.$has(node.name) ? control(node)?.type !== "hidden" : isFormCustom(node);
}

function isDisabled(node: N): boolean {
  if (node.ns !== HTML || !(canBeDisabled.$has(node.name) || isFormCustom(node))) return false;
  if (hasAttr(node, "disabled")) return true;
  if (node.name === "option") {
    const group = selectOrGroupOf(node);
    return isHtml(group, "optgroup") && hasAttr(group!, "disabled");
  }
  if (node.name === "optgroup") return false;
  for (let child = node, at = node.parent; at !== null; child = at, at = at.parent) {
    if (!isHtml(at, "fieldset") || !hasAttr(at, "disabled")) continue;
    if (child !== html.childrenNamed(at, "legend")[0]) return true;
  }
  return false;
}

function formOf(node: N): N | null {
  const id = getAttr(node, "form");
  if (id === null || !(node.flags & CONNECTED)) return node.rare?.parserForm ?? core.closestHtml(node.parent, "form");
  const found = core.referenceTarget(core.elementById(node.scope!, id));
  return isHtml(found, "form") ? found : null;
}

function wrapFor(node: N, target: N | null) {
  return wrapOrNull(target === null || target.scope === node.scope ? target : core.retarget(target, node));
}

function controlsOf(form: N): N[] {
  return core.filterReferrers(form, node => isListed(node) && formOf(node) === form);
}

function labeledControl(label: N): N | null {
  const id = getAttr(label, "for");
  const isControl = (node: N | null) => (node = core.referenceTarget(node)) !== null && isLabelable(node);
  const found = id === null ? core.findDescendant(label, isControl) : core.elementById(core.rootOf(label), id);
  return isControl(found) ? core.referenceTarget(found) : null;
}

function labelsOf(node: N): N[] {
  return core.filterReferrers(node, it => isHtml(it, "label") && labeledControl(it) === node);
}

function labelList(node: N) {
  return same(node, "labels", () => nodes.collectionOf(node, () => labelsOf(node), nodes.NodeList, nodes.Nodes));
}

function willValidate(node: N): boolean {
  return !control(node).isBarred() && !isDisabled(node) && core.closestHtml(node, "datalist") === null;
}

function isValid(node: N): boolean {
  return control(node).customError === "" && control(node).errors().length === 0;
}

const messages = {
  valueMissing: "Please fill out this field.",
  typeMismatch: "Please enter a valid value.",
  patternMismatch: "Please match the requested format.",
  tooLong: "Please shorten this text.",
  tooShort: "Please lengthen this text.",
  rangeUnderflow: "The value is too small.",
  rangeOverflow: "The value is too large.",
  stepMismatch: "Please enter a valid value.",
  badInput: "Please enter a valid value.",
};

function validationMessage(node: N): string {
  return willValidate(node) ? control(node).customError || (messages[control(node).errors()[0]] ?? "") : "";
}

function validate(candidates: N[], reports: boolean): boolean {
  const invalid = candidates.filter(node => willValidate(node) && !isValid(node));
  const unhandled = invalid.filter(node => events.fire(node, "invalid", false, true));
  const anchorOf = (node: N): N => (isFormCustom(node) && node.x.anchor) || node;
  const canFocus = (node: N) =>
    focusing.isFocusable(node) || !!(node.rare?.shadow && core.scopeOf(node.rare.shadow).delegatesFocus);
  const first = reports ? unhandled.find(node => node.doc.page !== null && canFocus(anchorOf(node))) : undefined;
  if (first !== undefined) {
    focusing.focus(anchorOf(first), focusing.SCRIPT);
    first.doc.page?.showBubble(anchorOf(first), validationMessage(first));
  }
  return invalid.length === 0;
}

class ValidityState {
  declare $impl: N;

  constructor() {
    core.illegalConstructor();
  }
  get customError() {
    const it = control(this.$impl);
    return isFormCustom(it.node) ? it.errors().includes("customError") : it.customError !== "";
  }
  get valid() {
    return isValid(this.$impl);
  }
}
for (const name in messages) {
  core.accessor(ValidityState.prototype, name, function (this: ValidityState) {
    return control(this.$impl).errors().includes(name);
  });
}
expose(ValidityState);

function validityOf(node: N) {
  return same(node, "validity", () => {
    const validity = Object.create(ValidityState.prototype);
    validity.$impl = node;
    return validity;
  });
}

const hasForm = {
  get form() {
    return wrapFor((this as any).$impl, formOf((this as any).$impl));
  },
};
const hasLabels = {
  get labels() {
    return isLabelable((this as any).$impl) ? labelList((this as any).$impl) : null;
  },
};
const hasValidity = {
  get willValidate() {
    return willValidate((this as any).$impl);
  },
  get validity() {
    return validityOf((this as any).$impl);
  },
  get validationMessage() {
    return validationMessage((this as any).$impl);
  },
  checkValidity(this: any) {
    return validate([this.$impl], false);
  },
  reportValidity(this: any) {
    return validate([this.$impl], true);
  },
  setCustomValidity(this: any, message: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    control(this.$impl).customError = normalizeNewlines(String(message));
    dirty(this.$impl);
  },
};

function setValidityStates(node: N, applies: boolean, valid: boolean, wasEdited: boolean) {
  setState(node, states.VALID, applies && valid);
  setState(node, states.INVALID, applies && !valid);
  setState(node, states.USER_VALID, applies && valid && wasEdited);
  setState(node, states.USER_INVALID, applies && !valid && wasEdited);
}

hooks.flushControls = doc => {
  const groups = new Set<N>();
  const list = Array.from(doc.dirtyControls);
  doc.dirtyControls.clear();
  for (const node of list) {
    if ((!(node.flags & CONNECTED) && node.id === 0) || node.doc !== doc) continue;
    if (node.name === "form" || node.name === "fieldset") {
      groups.$add(node);
      continue;
    }
    const before = node.state & states.INVALID;
    control(node).render();
    if (!isListed(node)) continue;
    setValidityStates(node, willValidate(node), isValid(node), control(node).wasEdited);
    if ((node.state & states.INVALID) === before) continue;
    const form = formOf(node);
    if (form !== null) groups.$add(form);
    for (let at = node.parent; at !== null; at = at.parent) if (isHtml(at, "fieldset")) groups.$add(at);
  }
  for (const group of groups) {
    const members = group.name === "form" ? controlsOf(group) : core.filterDescendants(group, isListed);
    const isGood = (node: N) => node.name === "fieldset" || !(node.state & states.INVALID);
    setValidityStates(group, true, members.every(isGood), false);
  }
  for (const node of doc.dirtyStyles.splice(0)) if (node.flags & flags.STYLE_UNSENT) hooks.sendStyle(node, node.id);
};

hooks.showControls = root => {
  const { dirtyControls } = root.doc;
  for (let at: N | null = root; at !== null; at = core.following(at, root)) {
    if (at.type === ELEMENT && (isListed(at) || isHtml(at, "form"))) dirtyControls.$add(at);
  }
  if (dirtyControls.size > 0) hooks.flushControls(root.doc);
};

const controlInserted = dirty;

function controlAttribute(node: N, name: string) {
  if (name === "form" && node.rare !== null) node.rare.parserForm = null;
  if (node.flags & CONNECTED || node.id !== 0) dirty(node);
}

function controlRemoved(node: N, scope: N) {
  if (node.x.valueRanges) node.x.forEachValueRange(it => it.disconnect());
  const form = node.rare?.parserForm;
  if (form && core.rootOf(form) !== core.rootOf(node)) node.rare!.parserForm = null;
  if (!(node.state & states.INVALID)) return;
  for (const group of core.filterDescendants(scope, it => (it.state & states.INVALID) !== 0)) {
    if (group.name === "form" || group.name === "fieldset") dirty(group);
  }
}

// ───────────────────────────── text ─────────────────────────────

const noDirection = process.platform === "darwin" ? "none" : "forward";

type Snapshot = { text: string; start: number; end: number };

/** An `input` or a `textarea`. */
class TextControl extends Control {
  /** What the editor shows. */
  text = "";
  isDirty = false;
  start = 0;
  end = 0;
  direction = noDirection;
  /** The value when it got the focus, or when `change` was last fired. */
  committed: string | null = null;
  lastEditWasByUser = false;
  editor: N | null = null;
  editorText: N | null = null;
  placeholderText: N | null = null;
  undos: Snapshot[] = [];
  redos: Snapshot[] = [];
  lastInputType = "";
  /** `select` is due even if nothing is selected. */
  hasSetSelection = false;
  valueRanges: WeakRef<any>[] | null = null;

  forEachValueRange(act: (range: any) => void) {
    if (this.valueRanges === null) return;
    this.valueRanges = this.valueRanges.filter(it => it.deref()?.control === this);
    for (const it of this.valueRanges) act(it.deref());
  }

  value(): string {
    return this.text;
  }

  isMutable(): boolean {
    return !hasAttr(this.node, "readonly") && !isDisabled(this.node);
  }

  isBarred() {
    return hasAttr(this.node, "readonly");
  }

  buildEditor(parent: N) {
    this.placeholderText = textIn(part(this.node, parent, "placeholder"));
    this.editor = part(this.node, parent, "-internal-editor");
    this.editorText = textIn(this.editor);
    this.render();
  }

  render() {
    const { node, editor, text } = this;
    const placeholder = this.isText ? getAttr(node, "placeholder") : null;
    setState(node, states.PLACEHOLDER_SHOWN, placeholder !== null && text === "");
    if (editor === null) return;
    const isSingleLine = node.name === "input";
    setText(
      this.placeholderText!,
      isSingleLine ? (placeholder ?? "").replace(/[\r\n]/g, "") : normalizeNewlines(placeholder ?? ""),
    );
    if (this.editorText!.data === text) return;
    const { start, end, direction } = this;
    setText(this.editorText!, text);
    if (text.endsWith("\n") !== (editor.last !== editor.first)) {
      if (editor.last !== editor.first) core.remove(editor.last!, true);
      else core.append(editor, core.createPlainElement(node.doc, "br", HTML));
    }
    this.start = start;
    this.end = end;
    this.direction = direction;
    this.showSelection();
  }

  showSelection() {
    const text = this.editorText;
    if (text === null || (text.doc.focused !== this.node && text.doc.selection?.r?.startNode !== text)) return;
    const { start, end } = this;
    if (this.direction === "backward") selectionOf(text.doc).select(text, end, text, start);
    else selectionOf(text.doc).select(text, start, text, end);
  }

  /** The document's selection changed, and it is in the editor. */
  readSelection(selection: $Dom.Selection) {
    const r = selection.r!;
    const offset = (node: N, at: number) => (node === this.editorText ? at : at === 0 ? 0 : this.text.length);
    this.start = offset(r.startNode, r.startOffset);
    this.end = offset(r.endNode, r.endOffset);
    if (selection.backward) this.direction = "backward";
    else if (this.direction === "backward" || process.platform !== "darwin") this.direction = "forward";
  }

  select(start: number, end: number, direction = "none") {
    end = Math.min(end, this.text.length);
    start = Math.min(start, end);
    if (direction !== "forward" && direction !== "backward") direction = noDirection;
    if (start === this.start && end === this.end && direction === this.direction) return;
    this.start = start;
    this.end = end;
    this.direction = direction;
    this.hasSetSelection = true;
    this.lastInputType = "";
    this.render();
    this.showSelection();
    this.node.doc.page?.controlSelectionChanged(this.node);
  }

  selectedText(): string {
    return this.type === "password" ? "" : this.text.slice(this.start, this.end);
  }

  setFromScript(text: string, start = 0, end = this.text.length) {
    this.isDirty = true;
    this.lastEditWasByUser = false;
    if (text === this.text) return;
    this.forEachValueRange(it => it.replaced(start, end - start, text.length - this.text.length + end - start));
    this.text = text;
    this.start = this.end = text.length;
    this.direction = noDirection;
    this.undos = [];
    this.redos = [];
    this.changed();
  }

  setDefault(text: string) {
    const { start, end } = this;
    this.setFromScript(text);
    this.isDirty = false;
    if (this.node.doc.focused !== this.node) this.start = Math.min(start, (this.end = Math.min(end, text.length)));
  }

  changed() {
    if (this.node.doc.focused === this.node) this.render();
    dirty(this.node);
  }

  /** What may be typed or pasted in place of `start..end`. */
  filter(inserted: string, start: number, end: number): string {
    const max = parseInteger(getAttr(this.node, "maxlength"));
    if (!(max >= 0) || this.type === "number") return inserted;
    const kept = inserted.slice(0, Math.max(0, max - (this.text.length - (end - start))));
    return kept.isWellFormed() ? kept : kept.slice(0, -1);
  }

  edit(start: number, end: number, inserted: string, inputType: string) {
    const continues = inputType === this.lastInputType && /^(?:insertText|insertCompo|deleteContent)/.test(inputType);
    this.committed ??= this.value();
    if (!continues) this.undos.push({ text: this.text, start: this.start, end: this.end });
    this.redos = [];
    const caret = start + inserted.length;
    this.restore(
      { text: this.text.slice(0, start) + inserted + this.text.slice(end), start: caret, end: caret },
      start,
    );
    this.lastInputType = inputType;
  }

  restore({ text, start, end }: Snapshot, changedFrom = -1) {
    if (this.valueRanges !== null) {
      const old = this.text;
      if (changedFrom < 0) while (old[++changedFrom] === text[changedFrom] && changedFrom < old.length);
      let kept = 0;
      while (kept < Math.min(old.length, text.length) - changedFrom && old.at(-1 - kept) === text.at(-1 - kept)) kept++;
      this.forEachValueRange(it =>
        it.replaced(changedFrom, old.length - kept - changedFrom, text.length - kept - changedFrom),
      );
    }
    this.text = text;
    this.start = start;
    this.end = end;
    this.isDirty = this.lastEditWasByUser = true;
    this.lastInputType = "";
    this.changed();
    this.showSelection();
  }

  travel(isUndo: boolean): boolean {
    const snapshot = (isUndo ? this.undos : this.redos).pop();
    if (snapshot === undefined) return false;
    this.committed ??= this.value();
    (isUndo ? this.redos : this.undos).push({ text: this.text, start: this.start, end: this.end });
    this.restore(snapshot);
    return true;
  }

  commit() {
    const { committed } = this;
    this.committed = null;
    if (committed === null || committed === this.value()) return;
    this.wasEdited = true;
    dirty(this.node);
    events.fire(this.node, "change", true);
  }

  lengthErrors(): string[] {
    const { length } = this.value();
    if (!this.lastEditWasByUser) return [];
    if (length > parseInteger(getAttr(this.node, "maxlength"))) return ["tooLong"];
    return length > 0 && length < parseInteger(getAttr(this.node, "minlength")) ? ["tooShort"] : [];
  }
}
declare global {
  namespace $Dom {
    type TextControl = TextControlImpl;
  }
}
type TextControlImpl = TextControl;

const selectable = new Set(splitTokens("text search url tel password textarea"));

function withSelection(self: any): TextControl {
  const it: TextControl = self.$impl.x;
  if (!selectable.$has(it.type)) {
    throw domError("InvalidStateError", `The input element's type ('${it.type}') does not support selection.`);
  }
  return it;
}

const hasSelection = {
  get selectionStart() {
    const it: TextControl = (this as any).$impl.x;
    return selectable.$has(it.type) ? it.start : null;
  },
  set selectionStart(value) {
    const it = withSelection(this);
    it.select(value! >>> 0, Math.max(value! >>> 0, it.end), it.direction);
  },
  get selectionEnd() {
    const it: TextControl = (this as any).$impl.x;
    return selectable.$has(it.type) ? it.end : null;
  },
  set selectionEnd(value) {
    const it = withSelection(this);
    it.select(it.start, value! >>> 0, it.direction);
  },
  get selectionDirection() {
    const it: TextControl = (this as any).$impl.x;
    return selectable.$has(it.type) ? it.direction : null;
  },
  set selectionDirection(value) {
    const it = withSelection(this);
    it.select(it.start, it.end, String(value));
  },
  select(this: any) {
    const it: TextControl = this.$impl.x;
    if (!it.isText) return;
    it.select(0, Infinity);
    focusing.focus(it.node, focusing.SCRIPT, { preventScroll: true });
    it.showSelection();
    if (it.node.doc.page !== null) it.node.doc.page.selectionSerial++;
  },
  setSelectionRange(this: any, start: number, end: number, direction: string | undefined = undefined) {
    if ($argumentCount() < 2) core.tooFew(2);
    withSelection(this).select(start >>> 0, end >>> 0, direction);
  },
  createValueRange(this: any, start: number, end: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    const it: TextControl = this.$impl.x;
    if (!selectable.$has(it.type)) throw domError("NotSupportedError", "The input element's type has no value ranges.");
    if ((start >>>= 0) > it.text.length || (end >>>= 0) > it.text.length) {
      throw domError("IndexSizeError", "An offset is larger than the value's length.");
    }
    const range = opaqueRange(it, start, Math.max(start, end));
    (it.valueRanges ??= []).push(new WeakRef(range.$impl));
    return range;
  },
  setRangeText(this: any, replacement: string, start: number | undefined = undefined, end?: number, mode = "preserve") {
    if ($argumentCount() < 1) core.tooFew(1);
    const it = withSelection(this);
    let [from, to] = start === undefined ? [it.start, it.end] : [start >>> 0, end! >>> 0];
    if (from > to) throw domError("IndexSizeError", "The start is larger than the end.");
    [from, to] = [Math.min(from, it.text.length), Math.min(to, it.text.length)];
    replacement = String(replacement);
    const after = from + replacement.length;
    const moved = (at: number, inside: number) => (at > to ? at + after - to : at > from ? inside : at);
    const preserved = [moved(it.start, from), moved(it.end, after)];
    const before = [it.start, it.end];
    it.setFromScript(it.text.slice(0, from) + replacement + it.text.slice(to), from, to);
    [it.start, it.end] = before;
    const [first, last] = { select: [from, after], start: [from, from], end: [after, after] }[mode] ?? preserved;
    it.select(first, last);
  },
};

// ───────────────────────────── input ─────────────────────────────

const inputTypes = new Set(
  splitTokens(`hidden text search tel url email password date month week time datetime-local number range color checkbox
  radio file submit image reset button`),
);
const textTypes = new Set(splitTokens("text search tel url email password date month week time datetime-local number"));
const buttonLabels = { __proto__: null, submit: "Submit", reset: "Reset", button: "", image: "Submit" };
const floatPattern = /^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/;
const emailPattern =
  /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const DAY = 86400000;
const pad = (value: number, length = 2) => String(value).padStart(length, "0");
const isoDate = (time: number) => new Date(time).toISOString().replace(/^\+0*/, "");
const shortTime = (iso: string) => iso.slice(-13, -1).replace(/(?::00)?\.000$|0+$/, "");

function parseIso(text: string, length: number): number {
  const digits = text.indexOf("-");
  const time = Date.parse(digits > 4 ? "+" + "0".repeat(Math.max(0, 6 - digits)) + text : text);
  return time === time && +text.slice(0, digits) > 0 && isoDate(time).startsWith(text.slice(0, length)) ? time : NaN;
}

function mondayOfFirstWeek(year: number): number {
  const fourth = new Date(0).setUTCFullYear(year, 0, 4);
  return fourth - ((new Date(fourth).getUTCDay() + 6) % 7) * DAY;
}

type Numeric = {
  parse(text: string): number;
  format(value: number): string;
  step: number;
  scale: number;
  hint?: string;
};
const plainNumber = {
  parse: text => (floatPattern.test(text) && isFinite(+text) ? +text : NaN),
  format: String,
  step: 1,
  scale: 1,
};
const numeric: Record<string, Numeric | undefined> = {
  __proto__: null as any,
  number: plainNumber,
  range: plainNumber,
  date: {
    parse: text => (/^\d{4,}-\d\d-\d\d$/.test(text) ? parseIso(text + "T00:00Z", 10) : NaN),
    format: value => isoDate(value).slice(0, -14),
    step: 1,
    scale: DAY,
  },
  month: {
    parse: text =>
      /^(?!0+-)\d{4,}-(?:0[1-9]|1[0-2])$/.test(text) ? (+text.slice(0, -3) - 1970) * 12 + +text.slice(-2) - 1 : NaN,
    format: value => pad(1970 + Math.floor(value / 12), 4) + "-" + pad((((value % 12) + 12) % 12) + 1),
    step: 1,
    scale: 1,
  },
  week: {
    parse(text) {
      if (!/^(?!0+-)\d{4,}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(text)) return NaN;
      const time = mondayOfFirstWeek(+text.slice(0, -4)) + (+text.slice(-2) - 1) * 7 * DAY;
      return time < mondayOfFirstWeek(+text.slice(0, -4) + 1) ? time : NaN;
    },
    format(value) {
      let year = new Date(value).getUTCFullYear() + 1;
      while (mondayOfFirstWeek(year) > value) year--;
      return pad(year, 4) + "-W" + pad(Math.floor((value - mondayOfFirstWeek(year)) / (7 * DAY)) + 1);
    },
    step: 1,
    scale: 7 * DAY,
  },
  time: {
    parse: text => (/^\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(text) ? parseIso(`1970-01-01T${text}Z`, 16) : NaN),
    format: value => shortTime(isoDate(value)),
    step: 60,
    scale: 1000,
  },
  "datetime-local": {
    parse: text =>
      /^\d{4,}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(text)
        ? parseIso(text.replace(" ", "T") + "Z", 16)
        : NaN,
    format: value => isoDate(value).slice(0, -13) + shortTime(isoDate(value)),
    step: 60,
    scale: 1000,
  },
};

const rounded = (value: number) => +value.toPrecision(15);

class Input extends TextControl {
  checked = false;
  isCheckedDirty = false;
  indeterminate = false;
  files: File[] = [];
  fileList: object | null = null;
  /** The text of a button or of a file picker, the swatch of a color, or what is before the thumb of a range. */
  look: N | null = null;
  dates: any = null;
  /** Of an image button. */
  image: any = null;
  point = [0, 0];

  constructor(node: N) {
    super(node);
    this.type = "text";
    this.isText = true;
  }

  isValueMode() {
    return this.isText || this.type === "range" || this.type === "color";
  }

  hasDateFields() {
    return this.isText && this.type !== "number" && numeric[this.type] !== undefined;
  }

  format(value: number): string {
    return numeric[this.type]!.format(value);
  }

  limit(name: string, fallback = NaN): number {
    const value = numeric[this.type]!.parse(getAttr(this.node, name) ?? "");
    return value === value ? value : this.type === "range" ? fallback : NaN;
  }
  min() {
    return this.limit("min", 0);
  }
  max() {
    return this.type === "range" ? Math.max(this.limit("max", 100), this.min()) : this.limit("max");
  }
  step(): number {
    const text = getAttr(this.node, "step") ?? "";
    const { step, scale } = numeric[this.type]!;
    return asciiLower(text) === "any" ? NaN : (parseFloat(text) > 0 ? parseFloat(text) : step) * scale;
  }
  stepBase(): number {
    const min = this.limit("min");
    return min === min ? min : this.limit("value") || (this.type === "week" ? -3 * DAY : 0);
  }

  sanitize(text: string): string {
    const kind = numeric[this.type];
    if (this.type === "range") {
      const [min, max, step] = [this.min(), this.max(), this.step()];
      let value = kind!.parse(text);
      value = value === value ? Math.min(Math.max(value, min), max) : min + (max - min) / 2;
      if (step === step) {
        value = rounded(this.stepBase() + Math.round((value - this.stepBase()) / step) * step);
        if (value > max) value = rounded(value - step);
      }
      return String(value);
    }
    if (kind !== undefined) {
      const value = kind.parse(text);
      return value !== value ? "" : this.type === "datetime-local" ? kind.format(value) : text;
    }
    if (this.type === "color") {
      const color = /^#[0-9a-f]{6}$/.test(text)
        ? parseInt(text.slice(1), 16)
        : Math.max(parseColor(text, 0xff), 0) >>> 8;
      return "#" + color.toString(16).padStart(6, "0");
    }
    if (text.includes("\n") || text.includes("\r")) text = text.replace(/[\r\n]/g, "");
    if (this.type !== "email" && this.type !== "url") return text;
    return this.type === "email" && hasAttr(this.node, "multiple") ? text.trim().replace(/\s*,\s*/g, ",") : text.trim();
  }

  value(): string {
    if (this.type === "number" && this.lastEditWasByUser) return this.sanitize(this.text.replace(/^[+]|[.]$/g, ""));
    if (this.isValueMode()) return this.sanitize(this.text);
    if (this.type === "file") return this.files.length > 0 ? "C:\\fakepath\\" + this.files[0].name : "";
    return getAttr(this.node, "value") ?? (this.type === "checkbox" || this.type === "radio" ? "on" : "");
  }

  setValue(value: string) {
    if (this.isValueMode()) {
      value = this.sanitize(value);
      if (value !== this.value() || value === "" || this.type !== "number") this.setFromScript(value);
      else this.isDirty = true;
    } else if (this.type !== "file") setAttr(this.node, "value", value);
    else if (value !== "") throw domError("InvalidStateError", "The value may only be set to the empty string.");
    else this.setFiles([]);
  }

  setFiles(files: File[]) {
    this.files = files;
    this.fileList = null;
    dirty(this.node);
  }

  filter(inserted: string, start: number, end: number): string {
    inserted = inserted.replace(/[\r\n]+$/, "").replace(/\r\n|[\r\n]/g, " ");
    if (this.type !== "number") return super.filter(inserted, start, end);
    let left = this.text.slice(0, start);
    const right = this.text.slice(end);
    for (const it of inserted.replace(/[^\d.eE+-]/g, "")) if (fitsInNumber(left, it, right)) left += it;
    return left.slice(start);
  }

  group(): N[] {
    const { node } = this;
    const name = getAttr(node, "name");
    if (!name) return [node];
    const form = formOf(node);
    const isMember = (it: N) =>
      isHtml(it, "input") && control(it).type === "radio" && getAttr(it, "name") === name && formOf(it) === form;
    const root = core.rootOf(node);
    const members = core.filterDescendants(root, isMember);
    return root.type === ELEMENT && isMember(root) ? [root, ...members] : members;
  }

  setChecked(checked: boolean) {
    const isRadio = this.type === "radio";
    if (checked === this.checked && !isRadio) return;
    this.checked = checked;
    dirty(this.node);
    if (!isRadio) return;
    for (const other of this.group()) {
      if (checked && other !== this.node) (other.x as Input).checked = false;
      dirty(other);
    }
  }

  stepBy(count: number): boolean {
    const [step, base, min, max] = [this.step() || 1, this.stepBase(), this.min(), this.max()];
    const parsed = numeric[this.type]!.parse(this.value());
    const old = parsed || 0;
    const steps = rounded((old - base) / step);
    const aligned = Number.isInteger(steps) ? steps + count : count > 0 ? Math.ceil(steps) : Math.floor(steps);
    let value = base + aligned * step;
    if (value < min) value = base + Math.ceil((min - base) / step) * step;
    if (value > max) value = base + Math.floor((max - base) / step) * step;
    if (min > max || (parsed === parsed && (value - old) * count < 0)) return false;
    const before = this.value();
    this.setValue(numeric[this.type]!.format(rounded(value)));
    return this.value() !== before;
  }

  isBarred() {
    const { type } = this;
    return type === "hidden" || type === "reset" || type === "button" || super.isBarred();
  }

  errors(): string[] {
    const { node, type } = this;
    const value = this.value();
    const errors: string[] = [];
    if (type === "radio") {
      const group = this.group();
      const isMissing =
        !!getAttr(node, "name") &&
        group.some(it => hasAttr(it, "required")) &&
        !group.some(it => (it.x as Input).checked);
      return isMissing ? ["valueMissing"] : errors;
    }
    if (
      hasAttr(node, "required") &&
      (type === "checkbox" ? !this.checked : value === "" && (this.isText || type === "file"))
    ) {
      if (!this.isText || this.isMutable()) errors.push("valueMissing");
    }
    const kind = numeric[type];
    if (kind !== undefined) {
      const number = kind.parse(value);
      const steps = (number - this.stepBase()) / this.step();
      if (value === "" && this.text !== "") errors.push("badInput");
      const [isUnder, isOver] = [number < this.min(), number > this.max()];
      const isReversed = type === "time" && this.min() > this.max();
      if (isUnder && (isOver || !isReversed)) errors.push("rangeUnderflow");
      if (isOver && (isUnder || !isReversed)) errors.push("rangeOverflow");
      if (Math.abs(steps - Math.round(steps)) > 1e-7) errors.push("stepMismatch");
    } else if (this.isText && value !== "") {
      const values = type === "email" && hasAttr(node, "multiple") ? value.split(",") : [value];
      if (type === "email" ? !values.every(it => emailPattern.test(it)) : type === "url" && !URL.canParse(value)) {
        errors.push("typeMismatch");
      }
      const pattern = getAttr(node, "pattern");
      if (pattern !== null && !values.every(it => matchesPattern(pattern, it))) errors.push("patternMismatch");
      errors.push(...this.lengthErrors());
    }
    return errors;
  }

  reset() {
    this.setFiles([]);
    this.setChecked(hasAttr(this.node, "checked"));
    if (this.isValueMode()) this.setDefault(this.sanitize(getAttr(this.node, "value") ?? ""));
    this.isDirty = this.isCheckedDirty = false;
  }

  entries(add: (name: string, value: unknown) => void, submitter: N | null) {
    const { node, type } = this;
    const name = getAttr(node, "name") ?? "";
    if (type in buttonLabels && node !== submitter) return;
    if ((type === "checkbox" || type === "radio") && !this.checked) return;
    if (type === "image") this.point.forEach((it, i) => add((name && name + ".") + "xy"[i], String(it)));
    else if (type === "file") {
      const none = [new File([], "", { type: "application/octet-stream" })];
      for (const file of this.files.length > 0 ? this.files : none) add(name, file);
    } else add(name, type === "hidden" && asciiLower(name) === "_charset_" ? submittedEncoding : this.value());
  }

  build(root: N) {
    const { node, type } = this;
    this.editor = this.editorText = this.placeholderText = this.look = this.dates = null;
    if (this.hasDateFields()) {
      const { DateFields } = require("internal/desktop/dom/date_fields");
      this.dates = new DateFields(this, root, { part, setText, changed: () => userChanged(node) });
    } else if (this.isText) {
      const container = part(node, root, "-webkit-textfield-decoration-container");
      this.buildEditor(part(node, container, "-internal-editor-container"));
      if (type === "search") part(node, container, "-webkit-search-cancel-button");
      if (type === "number") part(node, container, "-webkit-inner-spin-button");
    } else if (type === "range") {
      const track = part(node, part(node, root, "-internal-slider-container"), "-webkit-slider-runnable-track");
      this.look = part(node, track, "-internal-slider-before");
      part(node, track, "-webkit-slider-thumb");
      part(node, track, "-internal-slider-after");
    } else if (type === "color") {
      this.look = part(node, part(node, root, "-webkit-color-swatch-wrapper"), "-webkit-color-swatch");
    } else if (type === "file") {
      textIn(part(node, root, "file-selector-button", "span")).data = "Choose File";
      this.look = textIn(part(node, root, "-internal-file-name", "span"));
    } else if (type !== "checkbox" && type !== "radio") this.look = textIn(root);
    this.render();
  }

  render() {
    const { node, type, look } = this;
    const isRadio = type === "radio";
    const isCheckable = isRadio || type === "checkbox";
    const isNoneChecked = isRadio && !this.checked && !this.group().some(it => (it.x as Input).checked);
    setState(node, states.CHECKED, isCheckable && this.checked);
    setState(node, states.DEFAULT, isCheckable && hasAttr(node, "checked"));
    setState(node, states.INDETERMINATE, isRadio ? isNoneChecked : isCheckable && this.indeterminate);
    if (!isCheckable) setDefaultButton(node);
    if (numeric[type] !== undefined) {
      const isLimited = willValidate(node) && (this.min() === this.min() || this.max() === this.max());
      const isOut = isLimited && this.errors().some(it => it.startsWith("range"));
      setState(node, states.IN_RANGE, isLimited && !isOut);
      setState(node, states.OUT_OF_RANGE, isOut);
    }
    super.render();
    this.dates?.render();
    if (look === null) return;
    if (type === "range") {
      const fraction = (+this.value() - this.min()) / (this.max() - this.min()) || 0;
      styleOf(look).setProperty("flex-grow", String(fraction));
      styleOf(look.parent!.last!).setProperty("flex-grow", String(1 - fraction));
    } else if (type === "color") styleOf(look).setProperty("background-color", this.value());
    else if (type === "file") {
      const { length } = this.files;
      setText(look, length === 0 ? "No file chosen" : length === 1 ? this.files[0].name : length + " files");
    } else setText(look, getAttr(node, type === "image" ? "alt" : "value") ?? buttonLabels[type] ?? "");
  }

  typeChanged(type: string) {
    this.forEachValueRange(it => it.disconnect());
    const { node } = this;
    const [oldValue, wasValueMode, wasFile] = [this.value(), this.isValueMode(), this.type === "file"];
    const wasText = selectable.$has(this.type);
    this.type = type;
    this.isText = textTypes.$has(type);
    if (wasValueMode && !this.isValueMode() && type !== "file" && this.isDirty && oldValue !== "") {
      setAttr(node, "value", oldValue);
    } else if (!wasValueMode && this.isValueMode()) {
      this.text = getAttr(node, "value") ?? "";
      this.isDirty = false;
    }
    if (wasFile) this.setFiles([]);
    if (!wasText) this.start = this.end = 0;
    if (this.isValueMode())
      this.text = this.sanitize(wasValueMode && !this.isDirty ? (getAttr(node, "value") ?? "") : this.text);
    this.start = Math.min(this.start, (this.end = Math.min(this.end, this.text.length)));
    setState(node, states.IN_RANGE | states.OUT_OF_RANGE, false);
    if (node.flags & HOST) this.build(clearShadow(node));
    if (type === "radio" && this.checked) this.setChecked(true);
    if (type === "image" || this.image !== null) loader.updateButtonImage(node);
    this.showSelection();
  }

  async pickFiles() {
    const { node } = this;
    const { host } = node.doc.page!;
    const [multiple, directory] = [hasAttr(node, "multiple"), hasAttr(node, "webkitdirectory")];
    const paths = await host.pickFiles?.({
      multiple,
      directory,
      accept: (getAttr(node, "accept") ?? "").match(/[^,\s]+/g) ?? [],
    });
    if (!paths?.length) return void events.fire(node, "cancel", true);
    this.chooseFiles(paths);
  }

  chooseFiles(paths: string[]) {
    this.setFiles(Array.from(paths, path => this.node.doc.page!.host.fileFromPath(path)));
    userChanged(this.node);
  }

  async pickColor() {
    const color = await this.node.doc.page!.host.showColorPicker?.(this.value());
    if (!color) return;
    this.setValue(color);
    userChanged(this.node);
  }

  slideTo(x: number, y: number) {
    const track = this.look!.parent!;
    const mode = writingMode(track);
    const axis = +(mode !== "horizontal-tb");
    const rect = html.boundingRect(track);
    const thumb = html.boundingRect(this.look!.next!)[2 + axis];
    let fraction = ((axis ? y : x) - rect[axis] - thumb / 2) / (rect[2 + axis] - thumb);
    if (!(html.styleBits(track) & 4096) === (mode === "sideways-lr")) fraction = 1 - fraction;
    const before = this.value();
    this.setValue(String(this.min() + fraction * (this.max() - this.min())));
    if (this.value() !== before) fireInput(this.node);
  }
}

const writingMode = (node: N): string => core.sync(node.doc).computedStyle(node.id, "", "writing-mode");

function fitsInNumber(left: string, typed: string, right: string): boolean {
  const both = left + right;
  if (typed === ".") return !both.includes(".") && !/e/i.test(left) && !/^[^e]*[+-]/i.test(right);
  if (typed === "e" || typed === "E") return !/e/i.test(both) && !right.includes(".");
  if (typed !== "+" && typed !== "-") return left !== "" || !/^[+-]/.test(right);
  if (/[+-].*[+-]/.test(both) || /^[+-]/.test(right)) return false;
  return !/e/i.test(both) || left === "" || /e$/i.test(left);
}

function matchesPattern(pattern: string, value: string): boolean {
  try {
    new RegExp(pattern, "v");
    return new RegExp("^(?:" + pattern + ")$", "v").test(value);
  } catch {
    return true;
  }
}

function input(self: any): Input {
  return self.$impl.x;
}

function requireNumeric(it: Input): Numeric {
  const kind = numeric[it.type];
  if (kind === undefined) throw domError("InvalidStateError", "This input element does not support numeric values.");
  return kind;
}

function requireStep(it: Input): Input {
  requireNumeric(it);
  if (Number.isNaN(it.step())) throw domError("InvalidStateError", "This element does not have an allowed value step.");
  return it;
}

const arrows = { __proto__: null, ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 } as Record<string, any>;

function handleRadioKey(it: Input, direction: number) {
  const group = it.group().filter(node => node === it.node || focusing.isFocusable(node));
  const next = group.at((group.indexOf(it.node) + direction) % group.length)!;
  focusing.focus(next, focusing.KEYBOARD);
  html.click(next, true);
}

function handleRange(it: Input, event: any): boolean {
  const { node } = it;
  if (event.type === "mousedown" && event.button === 0) {
    it.committed = it.value();
    it.slideTo(event.clientX, event.clientY);
    node.doc.page!.trackMouse(
      (x, y) => it.slideTo(x, y),
      () => it.commit(),
    );
    return false;
  }
  if (event.type !== "keydown") return false;
  const before = it.value();
  const page = Math.max(1, (it.max() - it.min()) / 10 / (it.step() || 1));
  const mode = writingMode(node);
  const forward = !(html.styleBits(node) & 4096) === (mode === "sideways-lr") ? -1 : 1;
  const [right, down] = mode === "horizontal-tb" ? [forward, -1] : [mode.endsWith("rl") ? 1 : -1, forward];
  const steps = {
    ArrowUp: -down,
    ArrowRight: right,
    ArrowDown: down,
    ArrowLeft: -right,
    PageUp: page,
    PageDown: -page,
  }[event.key];
  if (steps !== undefined) it.stepBy(Math.round(steps));
  else if (event.key === "Home" || event.key === "End") it.setValue(String(event.key === "Home" ? it.min() : it.max()));
  else return false;
  if (it.value() !== before) userChanged(node);
  return true;
}

function stepByUser(it: Input, count: number) {
  const init = { bubbles: true, cancelable: true, composed: true, inputType: "insertReplacementText" };
  it.committed ??= it.value();
  if (!events.dispatch(it.node, new events.InputEvent("beforeinput", init)) || !it.stepBy(count)) return;
  fireInput(it.node);
  it.commit();
}

function handleInput(node: N, event: any, origin: N): boolean {
  const it: Input = node.x;
  const { type, key } = event;
  if (isDisabled(node)) return false;
  if (it.type === "range") return handleRange(it, event);
  if (it.dates !== null && type !== "keypress") return it.dates.handle(event, origin);
  if (type === "mousedown" && it.isMutable()) {
    const pseudo = origin.rare?.pseudo;
    if (pseudo === "-webkit-search-cancel-button") {
      it.edit(0, it.text.length, "", "deleteContent");
      fireInput(node);
      events.fire(node, "search", true);
    } else if (pseudo === "-webkit-inner-spin-button") {
      const [, top, , height] = html.boundingRect(origin);
      stepByUser(it, event.clientY < top + height / 2 ? 1 : -1);
    }
    return false;
  }
  if (type === "keydown") {
    if (it.type === "radio" && key in arrows) handleRadioKey(it, arrows[key]);
    else if (numeric[it.type] !== undefined && (key === "ArrowUp" || key === "ArrowDown")) {
      if (it.isMutable()) stepByUser(it, -arrows[key]);
    } else if (it.type === "search" && key === "Escape" && it.text !== "" && it.isMutable()) {
      it.edit(0, it.text.length, "", "deleteContent");
      fireInput(node);
    } else return false;
    return true;
  }
  if (type !== "keypress" || key !== "Enter" || !(it.isText || it.type === "checkbox" || it.type === "radio"))
    return false;
  it.commit();
  if (it.type === "search") events.fire(node, "search", true);
  submitImplicitly(node);
  return true;
}

function activateButton(node: N, type: string, origin: N) {
  if (isDisabled(node)) return;
  const form = isHtml(node.parent, "select") ? null : formOf(node);
  if (form !== null && (type === "submit" || type === "image")) submit(form, node, false);
  else if (form !== null && type === "reset") reset(form);
  else if (form === null || asciiLower(getAttr(node, "type") ?? "") === "button") interactive.invoke(node, origin);
}

const HTMLInputElement = define(
  "HTMLInputElement",
  "input",
  `accept alt defaultChecked? dirName disabled? formEnctype formMethod formNoValidate? formTarget max
  maxLength+-1 min minLength+-1 multiple? name pattern placeholder readOnly? required? size>20 src@ step defaultValue align
  useMap webkitdirectory? incremental? popoverTargetAction`,
  () => ({
    get width() {
      return loader.buttonSize(input(this).node, "width", 0);
    },
    set width(value) {
      setAttr(input(this).node, "width", String(Math.max(value | 0, 0)));
      react();
    },
    get height() {
      return loader.buttonSize(input(this).node, "height", 1);
    },
    set height(value) {
      setAttr(input(this).node, "height", String(Math.max(value | 0, 0)));
      react();
    },
    get type() {
      return input(this).type;
    },
    set type(value) {
      setAttr((this as any).$impl, "type", String(value));
      react();
    },
    get value() {
      return input(this).value();
    },
    set value(value) {
      input(this).setValue(value === null ? "" : String(value));
    },
    get checked() {
      return input(this).checked;
    },
    set checked(value) {
      input(this).isCheckedDirty = true;
      input(this).setChecked(!!value);
    },
    get indeterminate() {
      return input(this).indeterminate;
    },
    set indeterminate(value) {
      input(this).indeterminate = !!value;
      dirty(input(this).node);
    },
    get files() {
      const it = input(this);
      return it.type === "file" ? (it.fileList ??= fileList(() => it.files)) : null;
    },
    set files(list: any) {
      if (list != null && list[kList] === undefined) throw new TypeError("The value is not of type 'FileList'.");
      if (input(this).type === "file" && list instanceof FileList) {
        input(this).setFiles(Array.from(list as any));
        input(this).fileList = list;
      }
    },
    get webkitEntries() {
      return [];
    },
    get list() {
      const { node } = input(this);
      const found = core.elementById(core.rootOf(node), getAttr(node, "list") ?? "");
      return isHtml(core.referenceTarget(found), "datalist") ? wrap(found!) : null;
    },
    get valueAsNumber() {
      return numeric[input(this).type]?.parse(input(this).value()) ?? NaN;
    },
    set valueAsNumber(value) {
      if (Math.abs(value) === Infinity) throw new TypeError("The value provided is infinite.");
      const kind = requireNumeric(input(this));
      input(this).setValue(Number.isNaN(+value) ? "" : kind.format(+value));
    },
    get valueAsDate() {
      const { type } = input(this);
      const number = /^(?:date|month|week|time)$/.test(type) ? this.valueAsNumber : NaN;
      return number !== number ? null : new Date(type === "month" ? Date.UTC(1970, number) : number);
    },
    set valueAsDate(date: Date | null) {
      const kind = requireNumeric(input(this));
      if (!/^(?:date|month|week|time)$/.test(input(this).type)) {
        throw domError("InvalidStateError", "This input element does not support Date values.");
      }
      if (date != null && !require("node:util/types").isDate(date)) throw new TypeError("The value is not a Date.");
      const isMonth = input(this).type === "month";
      input(this).setValue(
        date == null || +date !== +date ? "" : isMonth ? date.toISOString().slice(0, 7) : kind.format(+date),
      );
    },
    stepUp(count = 1) {
      requireStep(input(this)).stepBy(count | 0);
    },
    stepDown(count = 1) {
      requireStep(input(this)).stepBy(-count | 0);
    },
    showPicker() {
      const { node, type } = input(this);
      const isMutable = !isDisabled(node) && !(input(this).isText && hasAttr(node, "readonly"));
      requirePicker(node, isMutable, type === "file" || type === "color");
      node.doc.page!.consumeActivation();
      if (input(this).type === "file") input(this).pickFiles();
      else if (input(this).type === "color") input(this).pickColor();
      else input(this).dates?.setOpen(true);
    },
  }),
  {
    created: node => (node.x = new Input(node)),
    shadow: node => (node.x as Input).build(core.attachShadow(node, true)),
    inserted(node) {
      const it: Input = node.x;
      if (it.type === "radio" && it.checked) it.setChecked(true);
      controlInserted(node);
    },
    removed: controlRemoved,
    mirrored: node => node.x.image !== null && loader.showButtonImage(node),
    adopted: node => node.x.type === "image" && loader.updateButtonImage(node),
    moved: node =>
      node.x.checked &&
      node.x.type === "radio" &&
      (node.flags & CONNECTED || formOf(node) !== null) &&
      node.x.setChecked(true),
    attribute(node, name, _, value) {
      const it: Input = node.x;
      if (name === "type") {
        const type = asciiLower(value ?? "");
        if ((inputTypes.$has(type) ? type : "text") !== it.type) it.typeChanged(inputTypes.$has(type) ? type : "text");
      } else if (name === "value" && !it.isDirty && it.isValueMode()) {
        it.setDefault(it.sanitize(value ?? ""));
      } else if (it.type === "range" && /^(?:min|max|step)$/.test(name)) {
        it.text = it.sanitize(it.isDirty ? it.text : (getAttr(node, "value") ?? ""));
      } else if (it.dates !== null && (name === "step" || name === "min")) {
        it.build(clearShadow(node));
      } else if (name === "checked" && !it.isCheckedDirty) it.setChecked(value !== null);
      else if (name === "name" && it.type === "radio" && it.checked) it.setChecked(true);
      else if (name === "src" && it.type === "image") loader.updateButtonImage(node);
      controlAttribute(node, name);
    },
    cloned(from, to) {
      const [source, copy]: Input[] = [from.x, to.x];
      copy.text = source.text;
      copy.isDirty = source.isDirty;
      copy.lastEditWasByUser = source.lastEditWasByUser;
      copy.checked = source.checked;
      copy.isCheckedDirty = source.isCheckedDirty;
      copy.indeterminate = source.indeterminate;
    },
    beforeActivate(node) {
      const it: Input = node.x;
      if (it.type !== "checkbox" && it.type !== "radio") return;
      const { checked, indeterminate } = it;
      const previous = it.type === "radio" ? it.group().find(other => (other.x as Input).checked) : undefined;
      it.isCheckedDirty = true;
      it.setChecked(it.type === "radio" || !checked);
      if (it.type === "checkbox") it.indeterminate = false;
      return { checked, indeterminate, previous };
    },
    cancelActivate(node, saved) {
      if (saved === undefined) return;
      const it: Input = node.x;
      it.setChecked(saved.checked);
      it.indeterminate = saved.indeterminate;
      saved.previous?.x.setChecked(true);
    },
    activate(node, event, origin, saved) {
      const it: Input = node.x;
      if (it.type === "image")
        it.point =
          event.isTrusted && event.detail > 0 ? [Math.trunc(event.offsetX), Math.trunc(event.offsetY)] : [0, 0];
      if (saved !== undefined && (it.type === "checkbox" || it.type === "radio")) {
        if (node.flags & CONNECTED && (it.type === "checkbox" || !saved.checked)) userChanged(node);
      } else if (it.type === "file" || it.type === "color") {
        if (!node.doc.page?.consumeActivation()) return;
        if (it.type === "file") it.pickFiles();
        else it.pickColor();
      } else if (it.type in buttonLabels) activateButton(node, it.type, origin);
    },
    handle: handleInput,
  },
);

// ───────────────────────────── textarea ─────────────────────────────

const normalizeNewlines = (text: string) => (text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text);

class TextArea extends TextControl {
  constructor(node: N) {
    super(node);
    this.type = "textarea";
    this.isText = true;
  }
  filter(inserted: string, start: number, end: number) {
    return super.filter(normalizeNewlines(inserted), start, end);
  }
  errors() {
    const isMissing = this.text === "" && hasAttr(this.node, "required") && this.isMutable();
    return isMissing ? ["valueMissing"] : this.lengthErrors();
  }
  reset() {
    this.setDefault(normalizeNewlines(core.childText(this.node)));
  }
  entries(add: (name: string, value: unknown) => void) {
    const isHard = /^(?:hard|physical)$/i.test(getAttr(this.node, "wrap") ?? "");
    add(getAttr(this.node, "name") ?? "", isHard && html.styleBits(this.node) & 1 ? this.wrapped() : this.text);
  }
  wrapped(): string {
    const { text, editor, editorText } = this;
    let out = "";
    for (let at = 0; at < text.length;) {
      const [, end, wraps] = this.node.doc.engine.movePoint(editor!.id, editorText!.id, at, false, 0, 3, NaN);
      const next = Math.max(wraps ? end : end + 1, at + 1) || text.length;
      out += text.slice(at, next) + (next < text.length && text[next - 1] !== "\n" ? "\n" : "");
      at = next;
    }
    return out;
  }
}

const dirtyIfConnected = (node: N) => node.flags & CONNECTED && dirty(node);

const HTMLTextAreaElement = define(
  "HTMLTextAreaElement",
  "textarea",
  `cols>20 dirName disabled? maxLength+-1 minLength+-1 name placeholder readOnly? required? rows>2 wrap`,
  () => ({
    get type() {
      return "textarea";
    },
    get value() {
      return input(this).text;
    },
    set value(value) {
      input(this).setFromScript(value === null ? "" : normalizeNewlines(String(value)));
    },
    get defaultValue() {
      return core.childText((this as any).$impl);
    },
    set defaultValue(value) {
      core.replaceAllWithText(String(value), (this as any).$impl);
      react();
    },
    get textLength() {
      return input(this).text.length;
    },
  }),
  {
    created: node => (node.x = new TextArea(node)),
    shadow: node => (node.x as TextArea).buildEditor(core.attachShadow(node, true)),
    inserted: controlInserted,
    removed: controlRemoved,
    attribute: controlAttribute,
    children: node => (node.x as TextArea).isDirty || (node.x as TextArea).reset(),
    cloned(from, to) {
      to.x.text = from.x.text;
      to.x.isDirty = from.x.isDirty;
      to.x.lastEditWasByUser = from.x.lastEditWasByUser;
    },
  },
);

// ───────────────────────────── button, and other small ones ─────────────────────────────

function setDefaultButton(node: N) {
  const form = isSubmitButton(node) ? formOf(node) : null;
  setState(node, states.DEFAULT, form !== null && controlsOf(form).find(isSubmitButton) === node);
}

class Button extends Control {
  render() {
    setDefaultButton(this.node);
  }
  isBarred() {
    return buttonType(this.node) !== "submit";
  }
  entries(add: (name: string, value: unknown) => void, submitter: N | null) {
    if (this.node === submitter) add(getAttr(this.node, "name") ?? "", getAttr(this.node, "value") ?? "");
  }
}

function buttonType(node: N): string {
  const type = asciiLower(getAttr(node, "type") ?? "");
  if (type === "submit" || type === "reset" || type === "button") return type;
  return hasAttr(node, "commandfor") || hasAttr(node, "command") ? "button" : "submit";
}

const HTMLButtonElement = define(
  "HTMLButtonElement",
  "button",
  "disabled? formEnctype formMethod formNoValidate? formTarget name value popoverTargetAction",
  () => ({
    get command() {
      return interactive.commandOf((this as any).$impl);
    },
    set command(value) {
      setAttr((this as any).$impl, "command", String(value));
      react();
    },
    get type() {
      return buttonType((this as any).$impl);
    },
    set type(value) {
      setAttr((this as any).$impl, "type", String(value));
      react();
    },
  }),
  {
    created: node => (node.x = new Button(node)),
    inserted: controlInserted,
    removed: controlRemoved,
    attribute: controlAttribute,
    activate: (node, _, origin) => activateButton(node, buttonType(node), origin),
  },
);
nodes.defineReference(HTMLButtonElement, "commandForElement", "commandfor", false);

class Barred extends Control {
  defaultValue: string | null = null;

  isBarred() {
    return true;
  }
  reset() {
    if (this.defaultValue !== null) core.replaceAllWithText(this.defaultValue, this.node);
    this.defaultValue = null;
  }
}
const createBarred = (node: N) => (node.x = new Barred(node));

const HTMLFieldSetElement = define(
  "HTMLFieldSetElement",
  "fieldset",
  "disabled? name",
  () => ({
    get type() {
      return "fieldset";
    },
    get elements() {
      return same((this as any).$impl, "elements", node => nodes.liveElements(node, isListed, false));
    },
  }),
  {
    created: createBarred,
    inserted: controlInserted,
    attribute(node, name) {
      if (name !== "disabled") return;
      const { focused } = node.doc;
      if (focused !== null && core.contains(node, focused) && isDisabled(focused)) hooks.blur(focused);
      for (const it of core.filterDescendants(node, isListed)) {
        dirtyIfConnected(it);
        if (isFormCustom(it)) reassociate(it);
      }
    },
  },
);

const HTMLOutputElement = define(
  "HTMLOutputElement",
  "output",
  "name",
  () => ({
    get type() {
      return "output";
    },
    get value() {
      return core.textContent((this as any).$impl);
    },
    set value(value) {
      const node: N = (this as any).$impl;
      node.x.defaultValue ??= core.textContent(node);
      core.replaceAllWithText(String(value), node);
      react();
    },
    get defaultValue() {
      return (this as any).$impl.x.defaultValue ?? this.value;
    },
    set defaultValue(value) {
      const node: N = (this as any).$impl;
      if (node.x.defaultValue === null) core.replaceAllWithText(String(value), node);
      else node.x.defaultValue = String(value);
      react();
    },
  }),
  { created: createBarred },
);
nodes.defineTokenList(HTMLOutputElement, "htmlFor", "for");

const HTMLObjectElement = define(
  "HTMLObjectElement",
  "object",
  "data@ type name useMap width height align archive code declare? hspace+0 standby vspace+0 codeBase@ codeType border!",
  () => Object.assign(loader.frameMembers(), loader.svgDocumentMembers()),
  loader.pluginHooks,
);

define("HTMLLegendElement", "legend", "align", () => ({
  get form() {
    const { parent } = (this as any).$impl;
    return isHtml(parent, "fieldset") ? wrapFor(parent, formOf(parent)) : null;
  },
}));

define(
  "HTMLLabelElement",
  "label",
  "htmlFor",
  () => ({
    get control() {
      return wrapFor((this as any).$impl, labeledControl((this as any).$impl));
    },
    get form() {
      const target = labeledControl((this as any).$impl);
      return target && wrapFor((this as any).$impl, formOf(target));
    },
  }),
  {
    activate(label, event, origin) {
      const target = labeledControl(label);
      if (target === null || core.containsComposed(target, origin)) return;
      if (interactive.isInInteractiveContent(origin, label)) return;
      const selected = event.isTrusted && event.detail > 0 ? selectionOf(label.doc).r : null;
      if (selected && !selected.collapsed && event.detail === 1 && core.contains(label, selected.startNode)) return;
      if (event.isTrusted) focusing.focus(target, control(target)?.isText ? focusing.SCRIPT : focusing.MOUSE);
      const { ctrlKey, shiftKey, altKey, metaKey, clientX, clientY, screenX, screenY, detail, pointerId, pointerType } =
        event;
      html.click(target, event.isTrusted, {
        ctrlKey,
        shiftKey,
        altKey,
        metaKey,
        clientX,
        clientY,
        screenX,
        screenY,
        detail,
        pointerId,
        pointerType,
      });
    },
  },
);

const leadingFloat = /^[\t\n\f\r ]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;
function numberAttr(node: N, name: string, fallback: number): number {
  const value = parseFloat(leadingFloat.exec(getAttr(node, name) ?? "")?.[1]!);
  return Number.isFinite(value) ? value : fallback;
}
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

class Gauge extends Control {
  bar: N | null = null;

  min() {
    return this.node.name === "meter" ? numberAttr(this.node, "min", 0) : 0;
  }
  max() {
    const max = numberAttr(this.node, "max", 1);
    return this.node.name === "meter" ? Math.max(max, this.min()) : max > 0 ? max : 1;
  }
  value() {
    return clamp(numberAttr(this.node, "value", 0), this.min(), this.max());
  }
  low() {
    return clamp(numberAttr(this.node, "low", this.min()), this.min(), this.max());
  }
  high() {
    return clamp(numberAttr(this.node, "high", this.max()), this.low(), this.max());
  }
  optimum() {
    return clamp(numberAttr(this.node, "optimum", (this.min() + this.max()) / 2), this.min(), this.max());
  }
  build() {
    const { node } = this;
    const prefix = "-webkit-" + node.name;
    const inner = part(node, core.attachShadow(node, true), prefix + "-inner-element");
    this.bar = part(node, part(node, inner, prefix + "-bar"), prefix + "-value");
    this.render();
  }
  render() {
    const { node, bar } = this;
    if (node.name === "progress") setState(node, states.INDETERMINATE, !hasAttr(node, "value"));
    if (bar === null) return;
    styleOf(bar).setProperty("inline-size", ((this.value() - this.min()) / (this.max() - this.min()) || 0) * 100 + "%");
    if (node.name !== "meter") return;
    const region = (value: number) => (value < this.low() ? 0 : value > this.high() ? 2 : 1);
    const distance = Math.abs(region(this.value()) - region(this.optimum()));
    core.setPseudo(bar, `-webkit-meter-${["optimum", "suboptimum", "even-less-good"][distance]}-value`, node);
  }
}

const gaugeHooks = {
  created: (node: N) => (node.x = new Gauge(node)),
  shadow: (node: N) => node.x.build(),
  attribute: dirtyIfConnected,
};
const HTMLMeterElement = define("HTMLMeterElement", "meter", "", undefined, gaugeHooks);
const HTMLProgressElement = define(
  "HTMLProgressElement",
  "progress",
  "",
  () => ({
    get position() {
      const it: Gauge = (this as any).$impl.x;
      return hasAttr(it.node, "value") ? it.value() / it.max() : -1;
    },
  }),
  gaugeHooks,
);
function defineGauge(ctor: any, names: string) {
  for (const name of splitTokens(names)) {
    core.accessor(
      ctor.prototype,
      name,
      function (this: any) {
        return this.$impl.x[name]();
      },
      function (this: any, value) {
        if (!Number.isFinite(+value)) throw new TypeError("The provided double value is non-finite.");
        if (this.$impl.name === "progress" && name === "max" && +value <= 0) return;
        setAttr(this.$impl, name, String(+value));
        react();
      },
    );
  }
}

core.extend(HTMLMeterElement, ctor => defineGauge(ctor, "value min max low high optimum"));
core.extend(HTMLProgressElement, ctor => defineGauge(ctor, "value max"));

// ───────────────────────────── select ─────────────────────────────

class Option {
  selected = false;
  isDirty = false;
  owner: N | null = null;
  label: N | null = null;
}
const option = (node: N): Option => node.x;
const isOption = (node: N) => isHtml(node, "option");
const optionValue = (node: N) => getAttr(node, "value") ?? optionText(node);
const optionLabel = (node: N) => getAttr(node, "label") || optionText(node);

function optionText(node: N): string {
  let text = "";
  for (let at = node.first; at !== null;) {
    if (at.type === core.TEXT || at.type === core.CDATA) text += at.data;
    const isScript = at.name === "script" && (at.ns === HTML || at.ns === core.SVG);
    at = isScript ? core.followingSkip(at, node) : core.following(at, node);
  }
  return splitTokens(text).join(" ");
}

const endsListOfOptions = new Set(splitTokens("datalist hr option selectedcontent"));

/** https://html.spec.whatwg.org/#option-element-nearest-ancestor-select */
function selectOf(node: N): N | null {
  let groups = isHtml(node, "optgroup") ? 1 : 0;
  for (let at = node.parent; at !== null; at = at.parent) {
    if (at.ns !== HTML) continue;
    if (at.name === "select") return at;
    if (endsListOfOptions.$has(at.name) || (at.name === "optgroup" && ++groups > 1)) return null;
  }
  return null;
}

function updateOwner(node: N) {
  const it = option(node);
  const [old, owner] = [it.owner, selectOf(node)];
  if (old === owner) return;
  it.owner = owner;
  if (old !== null && (it.selected || old.x.isDropDown())) {
    old.x.settle(false);
    if (hasSelectedContent) queueMicrotask(() => old.x.updateSelectedContent(false));
  } else dirty(old);
  if (owner === null) return;
  if (it.selected && !owner.x.isMultiple()) {
    for (const other of owner.x.options()) if (option(other).owner === owner) setSelected(other, other === node);
  }
  owner.x.settle(false);
}

let hasSelectedContent = false;

/** The `select` whose choice a `selectedcontent` shows. */
function selectShownBy(node: N): N | null {
  let found: N | null = null;
  for (let at = node.parent; at !== null; at = at.parent) {
    if (isOption(at) || isHtml(at, "selectedcontent") || (found !== null && isHtml(at, "select"))) return null;
    if (isHtml(at, "select")) found = at;
  }
  return found;
}

const enum Base {
  Select = 1,
  Options = 2,
}

function selectOrGroupOf(node: N | undefined): N | null {
  let at = node?.parent ?? null;
  while (at !== null && !isHtml(at, "select") && !isHtml(at, "optgroup")) at = at.parent;
  return at;
}

function setSelected(node: N, selected: boolean) {
  option(node).selected = selected;
  setState(node, states.CHECKED, selected);
}

class Select extends Control {
  options: () => N[];
  label: N | null = null;
  sizer: N | null = null;
  picker: N | null = null;
  active: N | null = null;
  anchor: N | null = null;
  typed = "";
  typedAt = -Infinity;

  button: N | null = null;
  /** `::picker(select)` */
  popover: N | null = null;
  /** What the `selectedcontent` elements show. */
  shown: N | null = null;
  lastFocused: N | null = null;
  isPressed = false;
  openedAt: number[] | null = null;

  constructor(node: N) {
    super(node);
    this.options = nodes.cached(
      node,
      () => core.filterDescendants(node, it => isOption(it) && selectOf(it) === node),
      false,
    );
  }

  base(): number {
    const { node } = this;
    return node.flags & CONNECTED && node.doc.page !== null ? core.sync(node.doc).baseAppearance(node.id) : 0;
  }
  isBaseListBox() {
    return !this.isDropDown() && this.base() !== 0;
  }
  authorButton(): N | null {
    const first = core.elementChildren(this.node)[0] ?? null;
    return isHtml(first, "button") ? first : null;
  }

  updateSelectedContent(always: boolean) {
    if (!hasSelectedContent || this.isMultiple()) return;
    const { node } = this;
    const chosen = this.selected()[0] ?? null;
    if ((chosen === this.shown && !always) || (chosen !== null && node.doc.parser?.option === chosen)) return;
    this.shown = chosen;
    for (const target of core.filterDescendants(
      node,
      it => isHtml(it, "selectedcontent") && selectShownBy(it) === node,
    )) {
      const fragment = core.createFragment(node.doc);
      for (let child = chosen && chosen.first; child !== null; child = child.next)
        core.clone(child, node.doc, true, fragment);
      core.replaceAll(fragment, target);
    }
  }

  childrenChanged() {
    for (const node of this.options()) if (option(node).owner !== this.node) updateOwner(node);
    dirty(this.node);
  }

  isMultiple() {
    return hasAttr(this.node, "multiple");
  }
  isDropDown() {
    return !this.isMultiple() && !(parseInteger(getAttr(this.node, "size")) > 1);
  }
  isOpen() {
    return (this.node.state & states.PICKER_OPEN) !== 0;
  }
  selected(): N[] {
    return this.options().filter(node => option(node).selected);
  }

  /** https://html.spec.whatwg.org/#selectedness-setting-algorithm */
  settle(showsResult = true) {
    dirty(this.node);
    if (this.isMultiple()) return;
    const selected = this.selected();
    const first = selected.length === 0 && this.isDropDown() ? this.options().find(it => !isDisabled(it)) : undefined;
    if (first !== undefined) setSelected(first, true);
    for (const node of selected.slice(0, -1)) setSelected(node, false);
    if (showsResult) this.updateSelectedContent(false);
  }

  selectOnly(chosen: N | undefined) {
    for (const node of this.options()) setSelected(node, node === chosen);
    if (chosen !== undefined) option(chosen).isDirty = true;
    dirty(this.node);
    this.updateSelectedContent(true);
  }

  choose(chosen: N) {
    option(chosen).isDirty = true;
    if (option(chosen).selected && this.selected().length === 1) return;
    this.selectOnly(chosen);
    userChanged(this.node);
  }

  errors() {
    if (!hasAttr(this.node, "required")) return [];
    const [first] = this.selected();
    const isPlaceholder = this.isDropDown() && first === this.options()[0] && selectOrGroupOf(first) === this.node;
    return first === undefined || (isPlaceholder && optionValue(first) === "") ? ["valueMissing"] : [];
  }

  reset() {
    for (const node of this.options()) {
      setSelected(node, hasAttr(node, "selected"));
      option(node).isDirty = false;
    }
    this.settle();
  }

  entries(add: (name: string, value: unknown) => void) {
    for (const node of this.selected()) if (!isDisabled(node)) add(getAttr(this.node, "name") ?? "", optionValue(node));
  }

  build() {
    const { node } = this;
    const root = core.attachShadow(node, true);
    core.scopeOf(root).slotFor = (child: N) => (child === this.authorButton() ? "button" : "");
    this.button = part(node, root, "-internal-select-button");
    const texts = part(node, this.button, "-internal-select-texts");
    this.label = textIn(part(node, texts, "-internal-select-label"));
    this.sizer = textIn(part(node, texts, "-internal-select-sizer"));
    setAttr(part(node, root, "-internal-select-button-slot", "slot"), "name", "button");
    this.popover = part(node, root, "picker(select)");
    this.picker = part(node, this.popover, "-internal-select-picker");
    core.append(this.picker, core.createPlainElement(node.doc, "slot", HTML));
    this.render();
  }

  render() {
    if (this.label === null) return;
    const rename = (it: N, pseudo: string) => it.rare!.pseudo === pseudo || core.setPseudo(it, pseudo, this.node);
    rename(this.button!, this.authorButton() === null ? "-internal-select-button" : "-internal-select-replaced-button");
    if (!this.isDropDown()) this.setOpen(false);
    rename(this.popover!, this.isDropDown() ? "picker(select)" : "-internal-select-list");
    const [first] = this.selected();
    setText(this.label, (first && optionLabel(first)) || "\u200b");
    setText(this.sizer!, this.options().map(optionLabel).join("\n"));
  }

  highlight(node: N | null) {
    if (this.active !== null) setState(this.active, states.TARGET, false);
    this.active = node;
    if (node === null) return;
    setState(node, states.TARGET, true);
    html.scrollIntoView(node, 3, 3, 1, true);
  }

  setOpen(open: boolean) {
    const { node } = this;
    const picker = this.picker!;
    const page = node.doc.page!;
    if (open === this.isOpen()) return;
    if (open ? this.base() & Base.Options : this.popover!.rare!.popover !== null) return this.setPopoverOpen(open);
    setState(node, states.PICKER_OPEN, open);
    interactive.setInTopLayer(picker, open);
    page.openPicker = open ? { node, close: () => this.setOpen(false) } : null;
    if (!open) return this.highlight(null);
    const [left, top, width, height] = html.boundingRect(node);
    const below = page.height - top - height;
    const style = styleOf(picker);
    style.cssText = `left:${left}px;top:${top + height}px;min-width:${width}px`;
    const size = html.boundingRect(picker);
    if (size[3] > below && top > below) {
      style.cssText = `left:${left}px;bottom:${page.height - top}px;min-width:${width}px;max-height:${top - 4}px`;
    } else style.setProperty("max-height", below - 4 + "px");
    style.setProperty("left", Math.max(0, Math.min(left, page.width - size[2])) + "px");
    this.highlight(this.selected()[0] ?? null);
  }

  setPopoverOpen(open: boolean) {
    const popover = this.popover!;
    if (!open) return interactive.hidePopover(popover, false);
    interactive.showPopover(popover, false, this.node);
    if (popover.rare!.popover === null) return;
    popover.rare!.popover.previousFocus = this.node;
    setState(this.node, states.PICKER_OPEN, true);
    const isCandidate = (it: N) => (!this.isDialog() || it !== this.authorButton()) && focusing.isFocusable(it);
    const candidates = this.isDialog()
      ? core.filterDescendants(this.node, isElement)
      : [...this.selected(), ...this.options()];
    const first = focusing.autofocusDelegate(this.node) ?? candidates.find(isCandidate);
    if (first !== undefined)
      focusing.focus(first, focusing.SCRIPT, { focusVisible: this.isPressed ? false : undefined });
  }

  /** There is more than options to interact with in the picker. */
  isDialog(): boolean {
    const button = this.authorButton();
    const isControl = (it: N) =>
      isElement(it) && !isOption(it) && !core.contains(button!, it) && focusing.isFocusable(it);
    return core.findDescendant(this.node, isControl) !== null;
  }

  focusable(): N[] {
    return this.options().filter(focusing.isFocusable);
  }

  pick(chosen: N) {
    if (this.isDropDown()) {
      const usesMouse = this.node.doc.page!.lastFocusWasMouse;
      this.choose(chosen);
      this.setOpen(false);
      if (usesMouse) setState(this.node, states.FOCUS_VISIBLE, false);
      return;
    }
    if (!this.isMultiple() && !option(chosen).selected) return this.choose(chosen);
    setSelected(chosen, !option(chosen).selected);
    option(chosen).isDirty = true;
    userChanged(this.node);
  }

  /** The farthest one that is in view, or else a page away. */
  pageFrom(all: N[], index: number, direction: number): N {
    const scroller = this.isDropDown() ? this.popover! : this.node;
    const [, top, , height] = html.boundingRect(scroller);
    const edges = all.map(html.boundingRect).map(it => (direction > 0 ? it[1] + it[3] : -it[1]));
    const farthest = (limit: number) => {
      let at = index;
      while (edges[at + direction] <= limit + 0.5) at += direction;
      return at;
    };
    const inView = farthest(direction > 0 ? top + height : -top);
    return all[inView !== index ? inView : farthest(edges[index] + height - html.boundingRect(all[index])[3])];
  }

  handleKeyInBase(event: any, origin: N): boolean {
    const { key } = event;
    const isOnOption = isOption(origin) && selectOf(origin) === this.node;
    if (key === "Tab") {
      if (this.isDropDown() && !this.isDialog()) this.setOpen(false);
      return false;
    }
    if (isOnOption && (key === "Enter" || (key === " " && event.timeStamp - this.typedAt >= 1000))) {
      this.pick(origin);
      return true;
    }
    if (textControl(origin) !== null || isHtml(origin, "select") || isHtml(origin, "input")) return false;
    const all = this.focusable();
    const around = core.closestHtml(origin, "option");
    let index = all.indexOf(around!);
    const mode = core
      .sync(origin.doc)
      .computedStyle((this.isDropDown() ? this.popover! : this.node).id, "", "writing-mode");
    const isSideways = key === "ArrowLeft" || key === "ArrowRight";
    let next: N | undefined;
    if (key in arrows) {
      const step = isSideways && mode.endsWith("-rl") ? -arrows[key] : arrows[key];
      if (index < 0) index = all.filter(it => core.compareOrder(it, origin) < 0).length - (step > 0 ? 1 : 0);
      if (!isSideways || mode !== "horizontal-tb") next = all[index + step];
    } else if (key === "Home" || key === "End") next = all.at(key === "Home" ? 0 : -1);
    else if (key === "PageUp" || key === "PageDown")
      next = this.pageFrom(all, Math.max(index, 0), key === "PageUp" ? -1 : 1);
    else if (isOnOption && isTyped(event)) next = this.typeAhead(event, all, index);
    else return false;
    if (next !== undefined) {
      focusing.focus(next, focusing.KEYBOARD, { preventScroll: true });
      html.scrollIntoView(next, 3, 3);
    }
    return true;
  }

  handleInBase(event: any, origin: N): boolean {
    const isInList = !this.isDropDown() || core.containsFlat(this.popover!, origin);
    if (event.type === "keydown") {
      if (isInList) return this.handleKeyInBase(event, origin);
      if (!(event.key in arrows) && (event.key !== "Enter" || process.platform !== "darwin"))
        return this.handleKey(event);
      if (event.key !== "Enter") this.setOpen(true);
      return true;
    }
    if (event.button !== 0) return false;
    if (event.type === "mousedown") {
      this.isPressed = true;
      this.openedAt = null;
      if (isInList) return false;
      this.setOpen(!this.isOpen());
      this.openedAt = [event.clientX, event.clientY];
      return true;
    }
    if (event.type !== "mouseup" || !this.isPressed) return false;
    this.isPressed = false;
    const { openedAt } = this;
    if (openedAt !== null && Math.hypot(event.clientX - openedAt[0], event.clientY - openedAt[1]) < 5) return false;
    const chosen = core.closestHtml(origin, "option");
    if (chosen === null || !isInList || selectOf(chosen) !== this.node || isDisabled(chosen)) return false;
    if (!interactive.isInInteractiveContent(origin, chosen)) this.pick(chosen);
    return false;
  }

  typeAhead({ key, timeStamp }: any, enabled: N[], index: number): N | undefined {
    this.typed = (timeStamp - this.typedAt < 1000 ? this.typed : "") + key.toLowerCase();
    this.typedAt = timeStamp;
    const from = this.typed.length === 1 ? index + 1 : Math.max(index, 0);
    const ordered = [...enabled.slice(from), ...enabled.slice(0, from)];
    return ordered.find(it => optionLabel(it).toLowerCase().startsWith(this.typed));
  }

  moveTo(node: N | undefined) {
    if (node === undefined) return;
    if (!this.isOpen()) this.choose(node);
    if (this.isOpen() || !this.isDropDown()) this.highlight((this.anchor = node));
  }

  handleKey(event: any): boolean {
    const { key, altKey, timeStamp } = event;
    const enabled = this.options().filter(it => !isDisabled(it) && !hasAttr(it, "hidden"));
    const index = enabled.indexOf(this.active ?? this.selected()[0]);
    const isArrow = key === "ArrowUp" || key === "ArrowDown";
    const isTyping = timeStamp - this.typedAt < 1000;
    if (this.isOpen() && (key === "Enter" || key === "Tab" || key === "Escape" || (altKey && isArrow))) {
      const { active } = this;
      this.setOpen(false);
      if (key !== "Escape" && active !== null) this.choose(active);
      return key !== "Tab";
    }
    const opens = (key === " " && !isTyping) || key === "Enter" || key === "F4" || (isArrow && altKey);
    if (!this.isOpen() && this.isDropDown() && (opens || (isArrow && process.platform === "darwin")))
      this.setOpen(true);
    else if (key in arrows) {
      const isReversed = !isArrow && !this.isDropDown() && writingMode(this.node).endsWith("rl");
      this.moveTo(enabled[index + (isReversed ? -arrows[key] : arrows[key])]);
    } else if (key === "Home" || key === "End") this.moveTo(enabled.at(key === "Home" ? 0 : -1));
    else if (key === "PageUp") this.moveTo(enabled[Math.max(0, index - 10)]);
    else if (key === "PageDown") this.moveTo(enabled[Math.min(enabled.length - 1, index + 10)]);
    else if (isTyped(event)) this.moveTo(this.typeAhead(event, enabled, index));
    else return false;
    return true;
  }

  pressInList(chosen: N, { shiftKey, ctrlKey, metaKey }: any) {
    if (this.isMultiple() && shiftKey && this.anchor !== null) {
      const all = this.options();
      const [from, to] = [all.indexOf(this.anchor), all.indexOf(chosen)].sort((a, b) => a - b);
      all.forEach((node, index) => setSelected(node, index >= from && index <= to && !isDisabled(node)));
      return userChanged(this.node);
    }
    this.anchor = this.active = chosen;
    if (!this.isMultiple() || !(ctrlKey || metaKey)) return this.choose(chosen);
    this.pick(chosen);
  }

  handle(event: any, origin: N): boolean {
    if (isDisabled(this.node)) return false;
    if (event.type !== "mousemove" && this.base() & Base.Options) return this.handleInBase(event, origin);
    if (event.type === "keydown") return this.handleKey(event);
    let chosen = core.closestHtml(origin, "option");
    if (chosen !== null && isDisabled(chosen)) chosen = null;
    if (!this.isDropDown()) {
      if (event.type === "mousedown" && chosen !== null) this.pressInList(chosen, event);
    } else if (event.type === "mousedown") {
      if (event.button === 0 && !core.containsFlat(this.picker!, origin)) this.setOpen(!this.isOpen());
    } else if (this.isOpen() && chosen !== null) {
      if (event.type === "mousemove" && chosen !== this.active) this.highlight(chosen);
      else if (event.type === "mouseup") {
        this.setOpen(false);
        this.choose(chosen);
      }
    }
    return false;
  }
}

const select = (self: any): Select => self.$impl.x;
const isElement = (node: N) => node.type === ELEMENT;
const isTyped = ({ key, altKey, ctrlKey, metaKey }: any) => key.length === 1 && !ctrlKey && !metaKey && !altKey;

function requirePicker(node: N, isMutable: boolean, isForAnyOrigin: boolean) {
  if (!isMutable) throw domError("InvalidStateError", "showPicker() cannot be used on immutable controls.");
  const { page } = node.doc;
  if (!isForAnyOrigin && page?.topOfSameOrigin() === null) {
    throw domError("SecurityError", "showPicker() called from cross-origin iframe.");
  }
  if (!page?.hasActivation()) throw domError("NotAllowedError", "showPicker() requires a user gesture.");
}

function addOption(node: N, element: any, before: any) {
  const reference: N | null = core.nodeOf(before) ?? (before == null ? null : (node.x.options()[before | 0] ?? null));
  if (reference !== null && !core.contains(node, reference)) throw domError("NotFoundError", "Not an option of this.");
  core.preInsert(core.unwrap(element, "add"), reference?.parent ?? node, reference);
  react();
}

function setOptionCount(node: N, count: number) {
  const options: N[] = node.x.options();
  for (const extra of options.slice(count)) core.remove(extra);
  for (let i = options.length; i < count; i++)
    core.insert(core.createPlainElement(node.doc, "option", HTML), node, null);
}

class HTMLOptionsCollection extends nodes.HTMLCollection {
  get length() {
    return this[kList].size();
  }
  set length(count) {
    setOptionCount(this[kList].node, count >>> 0);
    react();
  }
  get selectedIndex() {
    return wrap(this[kList].node).selectedIndex;
  }
  set selectedIndex(index) {
    wrap(this[kList].node).selectedIndex = index;
  }
  add(element: any, before: any = undefined) {
    if ($argumentCount() < 1) core.tooFew(1);
    addOption(this[kList].node, element, before);
  }
  remove(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    wrap(this[kList].node).remove(index);
  }
}
expose(HTMLOptionsCollection);

class Options extends nodes.Elements {
  node: N;

  constructor(node: N) {
    super(node.x.options);
    this.node = node;
  }
  set(index: number, value: any) {
    const old = this.items()[index];
    if (value == null) old && core.remove(old);
    else if (old !== undefined) core.replaceChild(old, core.unwrap(value, "set"), old.parent!);
    else {
      setOptionCount(this.node, index);
      addOption(this.node, value, null);
    }
    react();
  }
}

const HTMLSelectElement = define(
  "HTMLSelectElement",
  "select",
  "disabled? multiple? name required? size+0",
  () => ({
    get type() {
      return select(this).isMultiple() ? "select-multiple" : "select-one";
    },
    get options() {
      return same(select(this).node, "options", node => nodes.makeList(HTMLOptionsCollection, new Options(node)));
    },
    get length() {
      return select(this).options().length;
    },
    set length(count) {
      setOptionCount(select(this).node, count >>> 0);
      react();
    },
    get selectedOptions() {
      const it = select(this);
      const make = () => nodes.makeList(nodes.HTMLCollection, new nodes.Elements(() => it.selected()));
      return same(it.node, "selectedOptions", make);
    },
    get selectedIndex() {
      return select(this)
        .options()
        .findIndex(node => option(node).selected);
    },
    set selectedIndex(index) {
      select(this).selectOnly(select(this).options()[index | 0]);
    },
    get value() {
      const [first] = select(this).selected();
      return first === undefined ? "" : optionValue(first);
    },
    set value(value) {
      const it = select(this);
      it.selectOnly(it.options().find(node => optionValue(node) === String(value)));
    },
    item(index: number) {
      if ($argumentCount() < 1) core.tooFew(1);
      return this.options.item(index);
    },
    namedItem(name: string) {
      if ($argumentCount() < 1) core.tooFew(1);
      return this.options.namedItem(name);
    },
    add(element: any, before: any = undefined) {
      if ($argumentCount() < 1) core.tooFew(1);
      addOption(select(this).node, element, before);
    },
    remove(index: number | undefined = undefined) {
      const removed = arguments.length === 0 ? select(this).node : select(this).options()[index! | 0];
      if (removed?.parent) core.remove(removed);
      react();
    },
    showPicker() {
      const it = select(this);
      requirePicker(it.node, !isDisabled(it.node), false);
      if ((html.styleBits(it.node) & (1 | 256)) !== 1)
        throw domError("NotSupportedError", "The select element is not being rendered.");
      it.node.doc.page!.consumeActivation();
      if (it.isDropDown()) it.setOpen(true);
    },
  }),
  {
    created: node => (node.x = new Select(node)),
    list: node => Object.assign(new Options(node), { named: undefined, names: undefined }),
    shadow: node => node.x.build(),
    inserted: controlInserted,
    removed(node, scope, isMove) {
      if (node.x.isOpen() && !node.x.popover.rare.popover) node.x.setOpen(false);
      else if (!isMove) setState(node, states.PICKER_OPEN, false);
      controlRemoved(node, scope);
    },
    attribute(node, name, _, value) {
      controlAttribute(node, name);
      if (name !== "multiple" && name !== "size") return;
      if (name === "multiple" && value === null) for (const it of node.x.selected().slice(1)) setSelected(it, false);
      node.x.settle(false);
      node.x.updateSelectedContent(name === "multiple");
    },
    children: node => node.x.childrenChanged(),
    handle: (node, event, origin) => node.x.handle(event, origin),
  },
);
nodes.iterable(HTMLSelectElement, false);

function showLabel(node: N, label: string | null) {
  const it = option(node);
  if (it.label === null) {
    if (!label) return;
    const root = core.attachShadow(node, true);
    it.label = textIn(root);
    core.append(root, core.createPlainElement(node.doc, "slot", HTML));
  }
  setText(it.label, label ?? "");
  core.toggleAttr(it.label.next!, "hidden", !!label);
}

const HTMLOptionElement = define(
  "HTMLOptionElement",
  "option",
  "disabled? defaultSelected?",
  () => ({
    get form() {
      const owner = selectOf((this as any).$impl);
      return owner && wrapFor(owner, formOf(owner));
    },
    get label() {
      return getAttr((this as any).$impl, "label") ?? this.text;
    },
    set label(value) {
      setAttr((this as any).$impl, "label", String(value));
      react();
    },
    get value() {
      return optionValue((this as any).$impl);
    },
    set value(value) {
      setAttr((this as any).$impl, "value", String(value));
      react();
    },
    get text() {
      return optionText((this as any).$impl);
    },
    set text(value) {
      core.replaceAllWithText(String(value), (this as any).$impl);
      react();
    },
    get selected() {
      return option((this as any).$impl).selected;
    },
    set selected(value) {
      const node: N = (this as any).$impl;
      const owner: Select | undefined = selectOf(node)?.x;
      option(node).isDirty = true;
      if (value && owner !== undefined && !owner.isMultiple()) owner.selectOnly(node);
      else {
        setSelected(node, !!value);
        owner?.settle();
      }
    },
    get index() {
      const node: N = (this as any).$impl;
      return selectOf(node)?.x.options().indexOf(node) ?? 0;
    },
  }),
  {
    created: node => (node.x = new Option()),
    cloned: (from, to) => setSelected(to, option(from).selected),
    children: node => dirty(selectOf(node)),
    moved: updateOwner,
    inserted(node, isMove) {
      updateOwner(node);
      const { owner } = option(node);
      if (owner === null || !hasSelectedContent) return;
      if (isMove) queueMicrotask(() => owner.x.updateSelectedContent(false));
      else owner.x.updateSelectedContent(false);
    },
    removed: updateOwner,
    parsed: node => option(node).selected && option(node).owner?.x.updateSelectedContent(true),
    attribute(node, name, _, value) {
      const owner: Select | undefined = selectOf(node)?.x;
      if (name === "label") showLabel(node, value);
      if (name !== "selected" && name !== "disabled") return dirty(owner?.node ?? null);
      if (name === "selected") {
        setState(node, states.DEFAULT, value !== null);
        if (option(node).isDirty) return;
        if (value !== null && owner && !owner.isMultiple()) for (const it of owner.options()) setSelected(it, false);
        setSelected(node, value !== null);
      }
      owner?.settle();
    },
  },
);

define("HTMLOptGroupElement", "optgroup", "disabled? label", undefined, {
  children(node) {
    selectOf(node)?.x.childrenChanged();
    const hasLegend = isHtml(core.elementChildren(node)[0] ?? null, "legend");
    if (hasLegend) customStates(node).add(":legend");
    else node.rare?.customStates?.delete(":legend");
  },
  moved: node => core.filterDescendants(node, it => isHtml(it, "option")).forEach(it => updateOwner(it)),
  attribute: (node, name) => name === "disabled" && selectOf(node)?.x.settle(),
});

define("HTMLSelectedContentElement", "selectedcontent", "", undefined, {
  created: () => (hasSelectedContent = true),
  inserted(node, isMove) {
    const update = () => selectShownBy(node)?.x.updateSelectedContent(true);
    if (isMove) queueMicrotask(update);
    else update();
  },
});

define("HTMLDataListElement", "datalist", "", () => ({
  get options() {
    return same((this as any).$impl, "options", node => nodes.liveElements(node, isOption, false));
  },
}));

// ───────────────────────────── form ─────────────────────────────

function isSubmitButton(node: N): boolean {
  if (isHtml(node, "button")) return buttonType(node) === "submit" && !isHtml(node.parent, "select");
  return isHtml(node, "input") && (control(node).type === "submit" || control(node).type === "image");
}

function submitImplicitly(node: N) {
  const form = formOf(node);
  if (form === null) return;
  const all = controlsOf(form);
  const button = all.find(isSubmitButton);
  if (button !== undefined) html.click(button, true);
  else if (all.filter(it => it.name === "input" && control(it).isText).length <= 1) submit(form, form, false);
}

function reset(form: N) {
  if (!events.fire(form, "reset", true, true)) return;
  for (const node of controlsOf(form)) {
    control(node).wasEdited = false;
    control(node).reset();
    dirty(node);
  }
}

const filling = new Set<N>();
const hasDirname = new Set(splitTokens("hidden text search tel url email password submit reset button textarea"));
let submittedEncoding = "UTF-8";

function fillFormData(data: FormData, form: N, submitter: N | null) {
  if (filling.$has(form)) throw domError("InvalidStateError", "The form is constructing its entry list.");
  for (const node of controlsOf(form)) {
    if (isDisabled(node) || core.closestHtml(node, "datalist") !== null) continue;
    const it = control(node);
    it.entries((name, value) => name !== "" && data.append(name, value as any), submitter);
    const dirname = getAttr(node, "dirname");
    if (
      dirname &&
      getAttr(node, "name") &&
      hasDirname.$has(it.type) &&
      (!(it.type in buttonLabels) || node === submitter)
    ) {
      data.append(dirname, nodes.matches(node, ":dir(rtl)") ? "rtl" : "ltr");
    }
  }
  filling.$add(form);
  events.dispatch(form, new events.FormDataEvent("formdata", { bubbles: true, formData: data }));
  filling.$delete(form);
}

const { append: nativeAppend, set: nativeSet } = NativeFormData.prototype;

function addTo(data: object, add: Function, given: IArguments) {
  const [name, value, filename] = given;
  const isFile = $inheritsBlob(value) && value.name !== undefined;
  if (!$inheritsBlob(value) || (isFile && filename === undefined)) return add.$apply(data, given);
  const wanted = filename === undefined ? "blob" : `${filename}`.toWellFormed();
  const options = { type: value.type, lastModified: isFile ? value.lastModified : Date.now() };
  add.$call(data, name, new File([value], wanted, options), wanted);
}

class FormData extends NativeFormData {
  constructor(form: any = undefined, submitter?: any) {
    super();
    if (form === undefined) return;
    const node = core.unwrap(form, "FormData");
    const button = submitter == null ? null : core.unwrap(submitter, "FormData", 2);
    if (button !== null && formOf(button) !== node) {
      throw domError("NotFoundError", "The specified element is not owned by this form element.");
    }
    fillFormData(this, node, button);
  }
  append(name: string, value: unknown) {
    addTo(this, nativeAppend, arguments);
  }
  set(name: string, value: unknown) {
    addTo(this, nativeSet, arguments);
  }
  static [Symbol.hasInstance](value: unknown) {
    return Function.prototype[Symbol.hasInstance].$call(this === FormData ? NativeFormData : this, value);
  }
}
core.interfaces.FormData = FormData;

const submitting = new WeakSet<N>();

function submit(form: N, submitter: N, fromMethod: boolean) {
  if (!(form.flags & CONNECTED) || filling.$has(form) || (!fromMethod && submitting.has(form))) return;
  const button = submitter === form ? null : submitter;
  const setting = (name: string) => (button && getAttr(button, "form" + name)) ?? getAttr(form, name);
  if (!fromMethod) {
    submitting.add(form);
    const all = controlsOf(form);
    for (const node of all) {
      control(node).wasEdited = true;
      dirty(node);
    }
    const init = { bubbles: true, cancelable: true, submitter: wrapOrNull(button) };
    const proceeds =
      (setting("novalidate") !== null || validate(all, true)) &&
      events.dispatch(form, new events.SubmitEvent("submit", init));
    submitting.delete(form);
    if (!proceeds || !(form.flags & CONNECTED)) return;
  }
  const method = asciiLower(setting("method") ?? "");
  if (method === "dialog") {
    const dialog = core.closestHtml(form, "dialog");
    if (dialog !== null)
      interactive.closeDialog(
        dialog,
        button?.x.type === "image" ? button.x.point.join() : button && getAttr(button, "value"),
      );
    return;
  }
  const { encodeForm, encodingOfForm } = require("internal/desktop/web/encoding");
  const data = new FormData();
  submittedEncoding = encodingOfForm(getAttr(form, "accept-charset"), form.doc.encoding);
  fillFormData(data, form, button);
  submittedEncoding = "UTF-8";
  if (!(form.flags & CONNECTED)) return;
  const action = setting("action");
  const url = URL.parse((action ? core.resolveUrl(form.doc, action) : form.doc.url) ?? "");
  if (url === null || form.doc.page?.host.allowsForm?.(url.href) === false) return;
  const isPost = method === "post" && url.protocol !== "javascript:";
  const rel = core.splitTokens(asciiLower(getAttr(form, "rel") ?? ""));
  const options = {
    source: "form",
    element: button ?? form,
    isByUser: form.doc.page?.hasActivation(),
    replaceIn: form.doc.page?.isCompletelyLoaded ? null : form.doc.page,
    referrerPolicy: rel.includes("noreferrer") ? "no-referrer" : undefined,
    noopener: rel.includes("noreferrer") || rel.includes("noopener") || (rel.includes("opener") ? false : undefined),
  };
  const encode = (type: string) => encodeForm(data, type, getAttr(form, "accept-charset"), form.doc.encoding);
  if (isPost) Object.assign(options, { method: "POST", formData: data }, encode(asciiLower(setting("enctype") ?? "")));
  else if (method !== "post" && url.protocol !== "javascript:") url.search = "?" + encode("").text;
  const [{ page }, target] = [form.doc, setting("target") ?? baseTarget(form.doc)];
  if (!fromMethod || !plannedNavigations.has(form)) plannedNavigations.set(form, new Map());
  const planned = plannedNavigations.get(form)!;
  const run = () =>
    plannedNavigations.get(form) === planned &&
    planned.$get(target) === run &&
    page!.navigate(url.href, options, target);
  planned.$set(target, run);
  page?.queueTask(run);
}

function baseTarget(doc: Doc): string {
  const base = core.findDescendant(doc.node, it => isHtml(it, "base") && core.hasAttr(it, "target"));
  return (base && getAttr(base, "target")) ?? "";
}

/** By target. */
const plannedNavigations = new WeakMap<N, Map<string, Function>>();

class RadioNodeList extends nodes.NodeList {
  get value() {
    const checked = this[kList].items().find(node => control(node).type === "radio" && node.x.checked);
    return checked === undefined ? "" : checked.x.value();
  }
  set value(value) {
    const isIt = (node: N) => control(node).type === "radio" && node.x.value() === String(value);
    this[kList].items().find(isIt)?.x.setChecked(true);
  }
}
class HTMLFormControlsCollection extends nodes.HTMLCollection {
  namedItem(name: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].named(`${name}`);
  }
}
expose(RadioNodeList);
expose(HTMLFormControlsCollection);

class Controls extends nodes.Elements {
  named(name: string) {
    const find = () => this.items().filter(node => getAttr(node, "id") === name || getAttr(node, "name") === name);
    const found = name === "" ? [] : find();
    return found.length > 1 ? nodes.makeList(RadioNodeList, new nodes.Nodes(find)) : wrapOrNull(found[0]);
  }
}

function elementsOf(form: N) {
  const compute = () => controlsOf(form).filter(node => control(node).type !== "image");
  return same(form, "elements", () => nodes.collectionOf(form, compute, HTMLFormControlsCollection, Controls));
}

class FormProperties {
  form: N;
  overridesBuiltIns = true;
  pastNames = new Map<string, N>();

  constructor(form: N) {
    this.form = form;
  }
  size() {
    return elementsOf(this.form).length;
  }
  at(index: number) {
    return elementsOf(this.form)[index];
  }
  images() {
    return core.filterDescendants(
      this.form,
      node => isHtml(node, "img") && core.closestHtml(node, "form") === this.form,
    );
  }
  named(name: string) {
    if (name === "") return null;
    const matches = (node: N) => getAttr(node, "id") === name || getAttr(node, "name") === name;
    const find = () => {
      const controls = elementsOf(this.form)[kList].items().filter(matches);
      return controls.length > 0 ? controls : this.images().filter(matches);
    };
    const found = find();
    if (found.length > 1)
      return same(this.form, "named " + name, () => nodes.makeList(RadioNodeList, new nodes.Nodes(find)));
    if (found.length === 1) this.pastNames.$set(name, found[0]);
    const node = this.pastNames.$get(name);
    if (node === undefined) return null;
    if ((isHtml(node, "img") ? core.closestHtml(node, "form") : formOf(node)) === this.form) return wrap(node);
    this.pastNames.$delete(name);
    return null;
  }
  names() {
    const own = [...elementsOf(this.form)[kList].items(), ...this.images()].flatMap(node => [
      getAttr(node, "id"),
      getAttr(node, "name"),
    ]);
    return [...own, ...this.pastNames.keys()].filter(name => name && this.named(name) !== null);
  }
}

const HTMLFormElement = define(
  "HTMLFormElement",
  "form",
  "acceptCharset autocomplete enctype encoding method name noValidate? target rel",
  () => ({
    get elements() {
      return elementsOf((this as any).$impl);
    },
    get length() {
      return elementsOf((this as any).$impl).length;
    },
    submit(this: any) {
      submit(this.$impl, this.$impl, true);
    },
    requestSubmit(this: any, submitter: any = undefined) {
      const button = submitter == null ? this.$impl : core.unwrap(submitter, "requestSubmit");
      if (button !== this.$impl) {
        if (!isSubmitButton(button)) throw new TypeError("The specified element is not a submit button.");
        if (formOf(button) !== this.$impl) throw domError("NotFoundError", "The element is not owned by this form.");
      }
      submit(this.$impl, button, false);
    },
    reset(this: any) {
      reset(this.$impl);
      react();
    },
    checkValidity(this: any) {
      return validate(controlsOf(this.$impl), false);
    },
    reportValidity(this: any) {
      return validate(controlsOf(this.$impl), true);
    },
  }),
  { inserted: dirty, list: node => new FormProperties(node) },
);
nodes.iterable(HTMLFormElement, false);
nodes.defineTokenList(HTMLFormElement, "relList", "rel", ["noreferrer", "noopener", "opener"]);

const autofillFields = new Set(
  splitTokens(`name honorific-prefix given-name additional-name family-name honorific-suffix nickname username new-password
  current-password one-time-code organization-title organization street-address address-line1 address-line2 address-line3
  address-level4 address-level3 address-level2 address-level1 country country-name postal-code cc-name cc-given-name
  cc-additional-name cc-family-name cc-number cc-exp cc-exp-month cc-exp-year cc-csc cc-type transaction-currency
  transaction-amount language bday bday-day bday-month bday-year sex url photo`),
);
const contactFields = new Set(
  splitTokens(
    `tel tel-country-code tel-national tel-area-code tel-local tel-local-prefix tel-local-suffix tel-extension email impp`,
  ),
);

/** https://html.spec.whatwg.org/#idl-exposed-autofill-value */
function autofillValue(node: N): string {
  const tokens = splitTokens(asciiLower(getAttr(node, "autocomplete") ?? ""));
  let at = tokens.length - 1;
  if (tokens[0] === "on" || tokens[0] === "off") return at === 0 && control(node).type !== "hidden" ? tokens[0] : "";
  if (tokens[at] === "webauthn" && --at < 0) return "webauthn";
  const isContact = contactFields.$has(tokens[at]);
  if (!isContact && !autofillFields.$has(tokens[at])) return "";
  at--;
  if (isContact && /^(?:home|work|mobile|fax|pager)$/.test(tokens[at])) at--;
  if (tokens[at] === "shipping" || tokens[at] === "billing") at--;
  if (tokens[at]?.startsWith("section-")) at--;
  return at < 0 ? tokens.join(" ") : "";
}

core.mixin(
  {
    get autocomplete() {
      return autofillValue((this as any).$impl);
    },
    set autocomplete(value) {
      setAttr((this as any).$impl, "autocomplete", `${value}`);
      react();
    },
  },
  HTMLInputElement,
  HTMLSelectElement,
  HTMLTextAreaElement,
);

function defineAction(ctor: any, property: string) {
  core.accessor(
    ctor.prototype,
    property,
    function (this: any) {
      const value = getAttr(this.$impl, property.toLowerCase());
      return value ? (core.resolveUrl(this.$impl.doc, value) ?? value) : this.$impl.doc.url;
    },
    function (this: any, value) {
      setAttr(this.$impl, property.toLowerCase(), `${value}`.toWellFormed());
      react();
    },
  );
}

core.extend(HTMLFormElement, ctor => defineAction(ctor, "action"));
core.extend(HTMLInputElement, ctor => defineAction(ctor, "formAction"));
core.extend(HTMLButtonElement, ctor => defineAction(ctor, "formAction"));

const submittable = [HTMLInputElement, HTMLTextAreaElement, HTMLButtonElement, HTMLSelectElement, HTMLOutputElement];
core.mixin(hasForm, ...submittable, HTMLFieldSetElement, HTMLObjectElement);
core.mixin(hasValidity, ...submittable, HTMLFieldSetElement, HTMLObjectElement);
core.mixin(hasLabels, ...submittable, HTMLMeterElement, HTMLProgressElement);
core.mixin(hasSelection, HTMLInputElement, HTMLTextAreaElement);
nodes.defineReference(HTMLInputElement, "popoverTargetElement", "popovertarget", false);
nodes.defineReference(HTMLButtonElement, "popoverTargetElement", "popovertarget", false);

function OptionConstructor(text = "", value?: string, defaultSelected = false, selected = false) {
  const node = core.createPlainElement(core.realm.page.doc, "option", HTML);
  core.replaceAllWithText(String(text), node);
  if (value !== undefined) setAttr(node, "value", String(value));
  core.toggleAttr(node, "selected", !!defaultSelected);
  setSelected(node, !!selected);
  return wrap(node);
}
html.defineFactory("Option", OptionConstructor, HTMLOptionElement);

// ───────────────────────────── custom elements ─────────────────────────────

class CustomControl extends Control {
  value: any = null;
  invalid: string[] = [];
  form: N | null = null;
  disabled = false;
  anchor: N | null = null;

  isBarred() {
    return hasAttr(this.node, "readonly");
  }
  errors() {
    return this.invalid;
  }
  reset() {
    core.enqueueReaction(this.node, "formResetCallback");
  }
  entries(add: (name: string, value: unknown) => void) {
    if (this.value instanceof NativeFormData) for (const [name, value] of this.value as any) add(name, value);
    else if (this.value !== null) add(getAttr(this.node, "name") ?? "", this.value);
  }
}

function reassociate(node: N) {
  const it: CustomControl = node.x;
  if (node.flags & CONNECTED && hasAttr(node, "form")) (node.doc.customControls ??= new Set()).$add(node);
  else node.doc.customControls?.$delete(node);
  const [form, disabled] = [formOf(node), isDisabled(node)];
  if (form !== it.form) core.enqueueReaction(node, "formAssociatedCallback", wrapOrNull((it.form = form)));
  if (disabled !== it.disabled) core.enqueueReaction(node, "formDisabledCallback", (it.disabled = disabled));
  controlAttribute(node, "name");
}
const formAssociated = new core.Kind(html.HTMLElement, {
  inserted: reassociate,
  removed(node: N, scope: N) {
    controlRemoved(node, scope);
    reassociate(node);
  },
  moved: reassociate,
  attribute: reassociate,
});

hooks.idChanged = (doc, id) => {
  for (const node of doc.customControls!) if (getAttr(node, "form") === id) reassociate(node);
};

function customControl(self: ElementInternals): CustomControl {
  if (!(self.$impl.x instanceof CustomControl)) {
    throw domError("NotSupportedError", "The target element is not a form-associated custom element.");
  }
  return self.$impl.x;
}

class ElementInternals {
  declare $impl: N;

  constructor() {
    core.illegalConstructor();
  }
  get shadowRoot() {
    const root = this.$impl.rare?.shadow;
    return root && core.scopeOf(root).availableToInternals ? wrap(root) : null;
  }
  get states() {
    return customStates(this.$impl);
  }
  setFormValue(value: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    customControl(this).value = value ?? null;
  }
  setValidity(errors: any = undefined, message: unknown = undefined, anchor: unknown = undefined) {
    const inner = anchor === undefined ? null : core.nodeOf(anchor);
    if (anchor !== undefined && inner?.ns !== HTML) throw new TypeError("parameter 3 is not of type 'HTMLElement'.");
    const it = customControl(this);
    const invalid = [...Object.keys(messages), "customError"].filter(name => errors?.[name]);
    const text = message === undefined ? "" : normalizeNewlines(`${message}`);
    if (invalid.length > 0 && text === "") throw new TypeError("The message must not be empty if a flag is true.");
    it.invalid = invalid;
    it.customError = invalid.length > 0 ? text : "";
    dirty(it.node);
    if (inner !== null && !core.containsComposed(it.node, inner)) {
      throw domError("NotFoundError", "The anchor is not a shadow-including descendant of the target element.");
    }
    it.anchor = inner;
  }
  get form() {
    return wrapFor(customControl(this).node, formOf(customControl(this).node));
  }
  get labels() {
    return labelList(customControl(this).node);
  }
  get willValidate() {
    return willValidate(customControl(this).node);
  }
  get validity() {
    return validityOf(customControl(this).node);
  }
  get validationMessage() {
    return customControl(this).customError;
  }
  checkValidity() {
    return validate([customControl(this).node], false);
  }
  reportValidity() {
    return validate([customControl(this).node], true);
  }
}
for (const name of splitTokens("ActiveDescendant Controls DescribedBy Details ErrorMessage FlowTo LabelledBy Owns")) {
  const isList = name !== "ActiveDescendant";
  const property = `aria${name}Element${isList ? "s" : ""}`;
  const key = "internals " + property;
  core.accessor(
    ElementInternals.prototype,
    property,
    function (this: ElementInternals) {
      const found = this.$impl.rare!.references?.$get(key) ?? null;
      return isList ? nodes.frozenList(this.$impl, key, found) : wrapOrNull(found?.[0]);
    },
    function (this: ElementInternals, value) {
      const references = (this.$impl.rare!.references ??= new Map());
      if (value == null) references.$delete(key);
      else references.$set(key, nodes.elementsOf(value, isList));
    },
  );
}
for (const name of nodes.ariaNames)
  Object.defineProperty(ElementInternals.prototype, name, { value: null, writable: true });
expose(ElementInternals);

function makeFormAssociated(node: N) {
  node.x ??= new CustomControl(node);
  node.kind = formAssociated;
  setState(node, states.FORM_ASSOCIATED, true);
  node.doc.version++;
}

hooks.attachInternals = node => {
  const definition = node.flags & core.flags.CUSTOM || node.rare?.isPrecustomized ? node.rare!.definition : null;
  if (
    !definition ||
    node.rare!.is !== null ||
    definition.disabledFeatures.includes("internals") ||
    node.rare!.same?.$has("internals")
  ) {
    throw domError("NotSupportedError", "Unable to attach ElementInternals to this element.");
  }
  if (definition.formAssociated) makeFormAssociated(node);
  return same(node, "internals", () => {
    const internals = Object.create(ElementInternals.prototype);
    internals.$impl = node;
    return internals;
  });
};
hooks.makeFormAssociated = makeFormAssociated;
hooks.isDisabled = isDisabled;
hooks.formOf = formOf;
hooks.canActivate = node => {
  if (node.name === "a" || node.name === "area") return core.svgHref(node) !== null;
  if (node.name === "label") return labeledControl(node) !== null;
  const type = control(node)?.type;
  return type === "checkbox" || type === "radio" || (type !== "hidden" && !isDisabled(node));
};
hooks.invokesPopovers = node => {
  if (isHtml(node, "input") ? !(control(node).type in buttonLabels) : !isHtml(node, "button")) return false;
  return !isDisabled(node) && !(isSubmitButton(node) && formOf(node) !== null);
};
hooks.isFocusableOption = node => {
  const owner = selectOf(node);
  return owner !== null && !isDisabled(owner) && (owner.x.base() & Base.Options) !== 0;
};
hooks.isBaseListBox = node => node.x.isBaseListBox();
hooks.isSkippedOption = node => {
  const owner: Select | undefined = isOption(node) ? selectOf(node)?.x : undefined;
  if (!owner?.isBaseListBox()) return false;
  const all = owner.focusable();
  return node !== [node.doc.focused!, owner.lastFocused!, ...owner.selected(), all[0]].find(it => all.includes(it));
};
hooks.pickerOf = node => (node.x instanceof Select ? node.x.popover : null);
hooks.labeledControl = labeledControl;
hooks.isSkippedRadio = node => {
  if (node.name !== "input" || control(node).type !== "radio" || node.x.checked) return false;
  const group = (node.x as Input).group();
  if (group.some(it => it.x.checked && focusing.isFocusable(it)) || group.includes(node.doc.focused!)) return true;
  return node !== group.find(focusing.isFocusable);
};
hooks.beforeBlur = node => {
  if (node.x instanceof Select && !node.x.popover?.rare!.popover) node.x.setOpen(false);
  else if (node.x instanceof Option && node.x.owner !== null) node.x.owner.x.lastFocused = node;
  if (node.state & states.ACTIVE && !node.doc.page!.mouse.pressed.includes(node)) setState(node, states.ACTIVE, false);
  node.doc.page!.endComposition();
  if (!(node.x instanceof TextControl)) return;
  node.x.commit();
  if (node.name === "input" && node.x.editor?.id) html.scroll(node.doc, node.x.editor.id, 0, 0, false);
  node.doc.needsSync = node.doc.isSelectionUnsent = true;
};

function textControl(node: N | null): TextControl | null {
  return node !== null && node.x instanceof TextControl && node.x.isText && !(node.x as any).dates ? node.x : null;
}

export default { formOf, isDisabled, labelsOf, optionLabel, textControl };
