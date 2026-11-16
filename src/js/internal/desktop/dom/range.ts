const core = require("internal/desktop/dom/core");
const { contextOf } = require("internal/desktop/dom/node");
const { DOMRect, rectList } = require("internal/desktop/dom/geometry");

const { ELEMENT, ATTRIBUTE, COMMENT, DOCUMENT, DOCTYPE, FRAGMENT, INSTRUCTION } = core;
const { domError, expose, hooks, indexOf, isData, isText, lengthOf, rare, react, rootOf, unwrap, wrap } = core;
const { HAS_RANGES } = core.flags;

type N = $Dom.N;
type Doc = $Dom.Doc;

/** A live range. The nodes that it starts and ends in know it. */
class R {
  startNode: N;
  startOffset = 0;
  endNode: N;
  endOffset = 0;
  /** If it is the range of one. */
  selection: S | null = null;

  constructor(node: N) {
    this.startNode = this.endNode = node;
    register(node, this);
  }

  get collapsed() {
    return this.startNode === this.endNode && this.startOffset === this.endOffset;
  }

  set(startNode: N, startOffset: number, endNode: N, endOffset: number) {
    this.put(startNode, startOffset, endNode, endOffset);
    this.selection?.rangeSet();
  }

  put(startNode: N, startOffset: number, endNode: N, endOffset: number) {
    if (startNode !== this.startNode || endNode !== this.endNode) {
      this.detach();
      register(startNode, this);
      if (endNode !== startNode) register(endNode, this);
    } else if (startOffset === this.startOffset && endOffset === this.endOffset) return;
    this.startNode = startNode;
    this.startOffset = startOffset;
    this.endNode = endNode;
    this.endOffset = endOffset;
    this.selection?.changed();
  }

  detach() {
    unregister(this.startNode, this);
    const { endNode } = this;
    if (endNode !== this.startNode) unregister(endNode, this);
  }

  /** Both ends, through `move`, which returns nothing for an end that stays. */
  map(move: (node: N, offset: number) => [N, number] | undefined) {
    const start = move(this.startNode, this.startOffset) ?? [this.startNode, this.startOffset];
    const end = move(this.endNode, this.endOffset) ?? [this.endNode, this.endOffset];
    this.put(start[0], start[1], end[0], end[1]);
  }
}

declare global {
  namespace $Dom {
    type Range = R;
    type Selection = S;
    type Traversal = TraversalImpl;
  }
}
type TraversalImpl = Traversal;

const { SHADOW_ROOT } = core.flags;

function register(node: N, range: R) {
  (rare(node).ranges ??= []).push(range);
  node.flags |= HAS_RANGES;
  node.doc.ranges++;
}

function unregister(node: N, range: R) {
  const ranges: R[] = node.rare!.ranges!;
  ranges.splice(ranges.indexOf(range), 1);
  if (ranges.length === 0) node.flags &= ~HAS_RANGES;
  node.doc.ranges--;
}

function mapRanges(node: N | null, move: (node: N, offset: number) => [N, number] | undefined) {
  if (node !== null && node.flags & HAS_RANGES) for (const range of node.rare!.ranges!.slice()) range.map(move);
}

hooks.rangesAfterInsert = (parent: N, index: number, count: number) =>
  mapRanges(parent, (node, offset) => (node === parent && offset > index ? [node, offset + count] : undefined));

hooks.rangesBeforeRemove = (removed: N, parent: N) => {
  let index = -1;
  if (parent.flags & HAS_RANGES) {
    index = indexOf(removed);
    mapRanges(parent, (node, offset) => (node === parent && offset > index ? [node, offset - 1] : undefined));
  }
  for (let at: N | null = removed; at !== null; at = core.following(at, removed)) {
    if (!(at.flags & HAS_RANGES)) continue;
    if (index < 0) index = indexOf(removed);
    mapRanges(at, node => (node === at ? [parent, index] : undefined));
  }
  const { selection } = parent.doc;
  if (selection !== null && selection.isInShadow) selection.leave(removed);
};

hooks.rangesAfterReplaceData = (changed: N, start: number, count: number, length: number) =>
  mapRanges(changed, (node, offset) => {
    if (node !== changed || offset <= start) return;
    return [node, offset <= start + count ? start : offset + length - count];
  });

hooks.rangesAfterSplit = (split: N, rest: N, at: number) => {
  mapRanges(split, (node, offset) => (node === split && offset > at ? [rest, offset - at] : undefined));
  const index = indexOf(rest);
  mapRanges(split.parent, (node, offset) =>
    node === split.parent && offset === index ? [node, index + 1] : undefined,
  );
};

hooks.rangesBeforeMerge = (into: N, merged: N, length: number) => {
  mapRanges(merged, (node, offset) => (node === merged ? [into, offset + length] : undefined));
  const index = indexOf(merged);
  mapRanges(into.parent, (node, offset) => (node === into.parent && offset === index ? [into, length] : undefined));
};

hooks.rangesAdopted = (node: N, old: Doc) => {
  old.ranges -= node.rare!.ranges!.length;
  node.doc.ranges += node.rare!.ranges!.length;
};

function comparePoints(a: N, aOffset: number, b: N, bOffset: number): number {
  if (a === b) return Math.sign(aOffset - bOffset);
  if (core.compareOrder(a, b) > 0) return -comparePoints(b, bOffset, a, aOffset);
  for (let child = b; child.parent !== null; child = child.parent) {
    if (child.parent === a) return indexOf(child) < aOffset ? 1 : -1;
  }
  return -1;
}

/** In shadow-including tree order. */
function compareComposed(a: N, aOffset: number, b: N, bOffset: number): number {
  for (let x = a, xOffset = aOffset; ; x = core.hostOf(rootOf(x)), xOffset = -1) {
    for (let y = b, yOffset = bOffset; ; y = core.hostOf(rootOf(y)), yOffset = -1) {
      if (rootOf(x) === rootOf(y)) return comparePoints(x, xOffset, y, yOffset);
      if (!(rootOf(y).flags & SHADOW_ROOT)) break;
    }
    if (!(rootOf(x).flags & SHADOW_ROOT)) return 0;
  }
}

function commonAncestor(a: N, b: N): N {
  while (!core.contains(a, b)) a = a.parent!;
  return a;
}

/** The first node that starts at the point, or after it. */
function nodeAfter(node: N, offset: number): N | null {
  return core.childAt(node, offset) ?? core.followingSkip(node, null);
}

function checkPoint(node: N, offset: number) {
  if (node.type === DOCTYPE) throw domError("InvalidNodeTypeError", "The node provided is a doctype.");
  if (offset > lengthOf(node))
    throw domError("IndexSizeError", `The offset ${offset} is larger than the node's length.`);
}

function setStart(range: R, node: N, offset: number) {
  checkPoint(node, offset);
  const { endNode, endOffset } = range.selection?.span ?? range;
  if (rootOf(node) !== rootOf(range.endNode) || comparePoints(node, offset, range.endNode, range.endOffset) > 0) {
    range.set(node, offset, node, offset);
  } else range.set(node, offset, range.endNode, range.endOffset);
  range.selection?.compose(node, offset, endNode, endOffset);
}

function setEnd(range: R, node: N, offset: number) {
  checkPoint(node, offset);
  const { startNode, startOffset } = range.selection?.span ?? range;
  if (rootOf(node) !== rootOf(range.startNode) || comparePoints(node, offset, range.startNode, range.startOffset) < 0) {
    range.set(node, offset, node, offset);
  } else range.set(range.startNode, range.startOffset, node, offset);
  range.selection?.compose(startNode, startOffset, node, offset);
}

function parentOf(node: N): N {
  if (node.parent === null) throw domError("InvalidNodeTypeError", "The given Node has no parent.");
  return node.parent;
}

const enum Take {
  Delete,
  Extract,
  Clone,
}

function takeContents(startNode: N, startOffset: number, endNode: N, endOffset: number, mode: Take): N | null {
  const fragment = mode === Take.Delete ? null : core.createFragment(startNode.doc);
  const takeData = (node: N, from: number, to: number) => {
    if (fragment !== null) {
      core.insert(core.createData(node.doc, node.type, node.data.slice(from, to), node.name), fragment, null);
    }
    if (mode !== Take.Clone) core.replaceData(node, from, to - from, "");
  };
  const takePart = (node: N, fromNode: N, from: number, toNode: N, to: number) => {
    if (isData(node)) return takeData(node, from, to);
    const copy = fragment === null ? null : core.clone(node, node.doc, false, fragment);
    const inner = takeContents(fromNode, from, toNode, to, mode);
    if (copy !== null) core.insert(inner!, copy, null);
  };
  if (startNode === endNode && startOffset === endOffset) return fragment;
  if (startNode === endNode && isData(startNode)) {
    takeData(startNode, startOffset, endOffset);
    return fragment;
  }
  const common = commonAncestor(startNode, endNode);
  const childAbove = (node: N) => {
    if (node === common) return null;
    while (node.parent !== common) node = node.parent!;
    return node;
  };
  const first = childAbove(startNode);
  const last = childAbove(endNode);
  const contained: N[] = [];
  const stop = last ?? core.childAt(common, endOffset);
  for (let child = first ? first.next : core.childAt(common, startOffset); child !== stop; child = child!.next) {
    if (child!.type === DOCTYPE && fragment !== null) {
      throw domError("HierarchyRequestError", "The Range contains a doctype node.");
    }
    contained.push(child!);
  }
  if (first !== null) takePart(first, startNode, startOffset, first, lengthOf(first));
  for (const child of contained) {
    if (mode === Take.Clone) core.clone(child, child.doc, true, fragment);
    else if (mode === Take.Extract) core.insert(child, fragment!, null);
    else core.remove(child);
  }
  if (last !== null) takePart(last, last, 0, endNode, endOffset);
  return fragment;
}

function removeContents(range: R, mode: Take): N | null {
  const { startNode, startOffset, endNode, endOffset } = range;
  let node = startNode;
  let offset = startOffset;
  if (!core.contains(startNode, endNode)) {
    while (!core.contains(node.parent!, endNode)) node = node.parent!;
    offset = indexOf(node) + 1;
    node = node.parent!;
  }
  const fragment = takeContents(startNode, startOffset, endNode, endOffset, mode);
  range.set(node, offset, node, offset);
  return fragment;
}

function insertNode(range: R, node: N) {
  const start = range.startNode;
  if (
    start.type === COMMENT ||
    start.type === INSTRUCTION ||
    (isText(start) && start.parent === null) ||
    start === node
  ) {
    throw domError("HierarchyRequestError", "Nodes may not be inserted there.");
  }
  let reference = isText(start) ? start : core.childAt(start, range.startOffset);
  const parent = reference === null ? start : reference.parent;
  core.validateInsert(node, parent!, reference, false);
  if (isText(start)) reference = core.splitText(start, range.startOffset);
  if (node === reference) reference = reference.next;
  if (node.parent !== null) core.remove(node);
  const offset =
    (reference === null ? lengthOf(parent!) : indexOf(reference)) + (node.type === FRAGMENT ? lengthOf(node) : 1);
  core.preInsert(node, parent!, reference);
  if (range.collapsed) range.set(range.startNode, range.startOffset, parent!, offset);
}

function rangeText({ startNode, startOffset, endNode, endOffset }: R): string {
  if (startNode === endNode && isText(startNode)) return startNode.data.slice(startOffset, endOffset);
  let text = isText(startNode) ? startNode.data.slice(startOffset) : "";
  const stop = isData(endNode) ? endNode : nodeAfter(endNode, endOffset);
  for (let at = nodeAfter(startNode, startOffset); at !== stop && at !== null; at = core.following(at, null)) {
    if (isText(at)) text += at.data;
  }
  return isText(endNode) ? text + endNode.data.slice(0, endOffset) : text;
}

/** How the engine names a point. The node has an id, or its parent has. */
function pointId(node: N): number {
  return node.id !== 0 ? node.id : (node.parent?.id ?? 0);
}
function pointOffset(node: N, offset: number): number {
  if (node.id === 0) return core.mirroredFrom(node.next);
  return isText(node) ? offset : core.mirroredFrom(core.childAt(node, offset));
}
function toEngine(range: R): [number, number, number, number] {
  const { startNode, startOffset, endNode, endOffset } = range;
  return [pointId(startNode), pointOffset(startNode, startOffset), pointId(endNode), pointOffset(endNode, endOffset)];
}
function fromEngine(doc: Doc, id: number, offset: number): [N, number] {
  const node = doc.nodes[id]!;
  if (isText(node)) return [node, offset];
  return [node, offset === 0 ? lengthOf(node) : indexOf(doc.nodes[offset]!)];
}

function rangeRects(range: R): number[] {
  const doc = range.startNode.doc;
  if (range.startNode.scope === null || doc.page === null) return [];
  return core.sync(doc).rangeRects(...toEngine(range));
}

function boundsOf(rects: number[]) {
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rects.length; i += 4) {
    if (rects[i + 2] === 0 || rects[i + 3] === 0) continue;
    left = Math.min(left, rects[i]);
    top = Math.min(top, rects[i + 1]);
    right = Math.max(right, rects[i] + rects[i + 2]);
    bottom = Math.max(bottom, rects[i + 1] + rects[i + 3]);
  }
  return left === Infinity ? new DOMRect(...rects.slice(0, 4)) : new DOMRect(left, top, right - left, bottom - top);
}

class AbstractRange {
  declare $impl: R;

  constructor() {
    if (new.target === AbstractRange) core.illegalConstructor();
  }
  get startContainer() {
    return wrap(this.$impl.startNode);
  }
  get startOffset() {
    return this.$impl.startOffset;
  }
  get endContainer() {
    return wrap(this.$impl.endNode);
  }
  get endOffset() {
    return this.$impl.endOffset;
  }
  get collapsed() {
    const { startNode, startOffset, endNode, endOffset } = this.$impl;
    return startNode === endNode && startOffset === endOffset;
  }
}

class StaticRange extends AbstractRange {
  constructor(init: any) {
    super();
    if (init?.startOffset === undefined || init.endOffset === undefined) throw new TypeError("An offset is missing.");
    const startNode = unwrap(init.startContainer, "StaticRange");
    const endNode = unwrap(init.endContainer, "StaticRange");
    if ([startNode, endNode].some(node => node.type === DOCTYPE || node.type === ATTRIBUTE)) {
      throw domError("InvalidNodeTypeError", "Neither container may be a doctype or an attribute.");
    }
    const [startOffset, endOffset] = [init.startOffset >>> 0, init.endOffset >>> 0];
    this.$impl = { startNode, startOffset, endNode, endOffset } as R;
  }
}

/** Of the value of a text control. */
class ValueRange {
  control: any;
  startOffset: number;
  endOffset: number;

  constructor(control: any, start: number, end: number) {
    this.control = control;
    this.startOffset = start;
    this.endOffset = end;
  }

  /** The control itself has nothing at any offset but 0. */
  get startNode(): N {
    return this.control?.editorText ?? core.realm.page.doc.node;
  }
  get endNode(): N {
    return this.startNode;
  }

  replaced(start: number, count: number, length: number) {
    const move = (offset: number) =>
      offset <= start ? offset : offset <= start + count ? start : offset + length - count;
    this.startOffset = move(this.startOffset);
    this.endOffset = move(this.endOffset);
  }

  disconnect() {
    const { control } = this;
    if (control !== null) core.invalidate(control.node.doc);
    this.control = null;
    this.startOffset = this.endOffset = 0;
  }

  rects(): number[] {
    if (this.control === null || this.control.node.scope === null) return [];
    core.sync(this.control.node.doc);
    return this.control.editorText === null ? [] : rangeRects(this as any as R);
  }
}

class OpaqueRange extends AbstractRange {
  constructor() {
    core.illegalConstructor();
    super();
  }
  get startContainer() {
    return undefined as any;
  }
  get endContainer() {
    return undefined as any;
  }
  disconnect() {
    (this.$impl as any as ValueRange).disconnect();
  }
  getClientRects() {
    const it = this.$impl as any as ValueRange;
    return rectList(it.startOffset === it.endOffset ? [] : it.rects());
  }
  getBoundingClientRect() {
    return boundsOf((this.$impl as any as ValueRange).rects());
  }
}

function opaqueRange(control: object, start: number, end: number) {
  const range = Object.create(OpaqueRange.prototype);
  range.$impl = new ValueRange(control, start, end);
  return range;
}

function staticRange(startNode: N, startOffset: number, endNode: N, endOffset: number) {
  const range = Object.create(StaticRange.prototype);
  range.$impl = { startNode, startOffset, endNode, endOffset };
  return range;
}

const collected = new FinalizationRegistry<R>(range => range.detach());

function createRange(node: N) {
  const range = Object.create(Range.prototype);
  range.$impl = new R(node);
  collected.register(range, range.$impl);
  return range;
}

function rangeOf(startNode: N, startOffset: number, endNode: N, endOffset: number) {
  const range = createRange(startNode);
  range.$impl.set(startNode, startOffset, endNode, endOffset);
  return range;
}

class Range extends AbstractRange {
  constructor() {
    super();
    this.$impl = new R(core.realm.page.doc.node);
    collected.register(this, this.$impl);
  }
  get commonAncestorContainer() {
    return wrap(commonAncestor(this.$impl.startNode, this.$impl.endNode));
  }
  setStart(node: any, offset: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    core.brand(this);
    setStart(this.$impl, unwrap(node, "setStart"), offset >>> 0);
  }
  setEnd(node: any, offset: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    core.brand(this);
    setEnd(this.$impl, unwrap(node, "setEnd"), offset >>> 0);
  }
  setStartBefore(value: any) {
    core.brand(this);
    const node = unwrap(value, "setStartBefore");
    setStart(this.$impl, parentOf(node), indexOf(node));
  }
  setStartAfter(value: any) {
    core.brand(this);
    const node = unwrap(value, "setStartAfter");
    setStart(this.$impl, parentOf(node), indexOf(node) + 1);
  }
  setEndBefore(value: any) {
    core.brand(this);
    const node = unwrap(value, "setEndBefore");
    setEnd(this.$impl, parentOf(node), indexOf(node));
  }
  setEndAfter(value: any) {
    core.brand(this);
    const node = unwrap(value, "setEndAfter");
    setEnd(this.$impl, parentOf(node), indexOf(node) + 1);
  }
  collapse(toStart = false) {
    const range: R = this.$impl;
    if (toStart) range.set(range.startNode, range.startOffset, range.startNode, range.startOffset);
    else range.set(range.endNode, range.endOffset, range.endNode, range.endOffset);
  }
  selectNode(value: any) {
    const node = unwrap(value, "selectNode");
    const index = indexOf(node);
    this.$impl.set(parentOf(node), index, node.parent!, index + 1);
  }
  selectNodeContents(value: any) {
    const node = unwrap(value, "selectNodeContents");
    checkPoint(node, 0);
    this.$impl.set(node, 0, node, lengthOf(node));
  }
  compareBoundaryPoints(how: number, source: any) {
    if ($argumentCount() < 2) core.tooFew(2);
    const self: R = this.$impl;
    const other: R = source.$impl;
    how &= 0xffff;
    if (how > 3) throw domError("NotSupportedError", "The comparison method is not supported.");
    if (rootOf(self.startNode) !== rootOf(other.startNode)) {
      throw domError("WrongDocumentError", "The source range is in a different document than this range.");
    }
    const [node, offset] = how === 0 || how === 3 ? [self.startNode, self.startOffset] : [self.endNode, self.endOffset];
    if (how <= 1) return comparePoints(node, offset, other.startNode, other.startOffset);
    return comparePoints(node, offset, other.endNode, other.endOffset);
  }
  deleteContents() {
    removeContents(this.$impl, Take.Delete);
    react();
  }
  extractContents() {
    const fragment = removeContents(this.$impl, Take.Extract);
    react();
    return wrap(fragment!);
  }
  cloneContents() {
    const { startNode, startOffset, endNode, endOffset } = this.$impl;
    const fragment = takeContents(startNode, startOffset, endNode, endOffset, Take.Clone);
    react();
    return wrap(fragment!);
  }
  insertNode(node: any) {
    insertNode(this.$impl, unwrap(node, "insertNode"));
    react();
  }
  surroundContents(value: any) {
    const range: R = this.$impl;
    const parent = unwrap(value, "surroundContents");
    const container = (node: N) => (isText(node) ? (node.parent ?? node) : node);
    if (container(range.startNode) !== container(range.endNode)) {
      throw domError("InvalidStateError", "The Range has partially selected a non-Text node.");
    }
    if (parent.type === DOCUMENT || parent.type === DOCTYPE || parent.type === FRAGMENT) {
      throw domError("InvalidNodeTypeError", "The node provided cannot surround the contents.");
    }
    const fragment = removeContents(range, Take.Extract);
    core.replaceAll(null, parent);
    insertNode(range, parent);
    core.preInsert(fragment!, parent, null);
    this.selectNode(value);
    react();
  }
  cloneRange() {
    const { startNode, startOffset, endNode, endOffset } = this.$impl;
    return rangeOf(startNode, startOffset, endNode, endOffset);
  }
  detach() {
    core.brand(this);
  }
  isPointInRange(value: any, offset: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    const node = unwrap(value, "isPointInRange");
    return rootOf(node) === rootOf(this.$impl.startNode) && this.comparePoint(value, offset) === 0;
  }
  comparePoint(value: any, offset: number) {
    if ($argumentCount() < 2) core.tooFew(2);
    const range: R = this.$impl;
    const node = unwrap(value, "comparePoint");
    if (rootOf(node) !== rootOf(range.startNode)) {
      throw domError("WrongDocumentError", "The node provided and the Range are not in the same tree.");
    }
    checkPoint(node, (offset >>>= 0));
    if (comparePoints(node, offset, range.startNode, range.startOffset) < 0) return -1;
    return comparePoints(node, offset, range.endNode, range.endOffset) > 0 ? 1 : 0;
  }
  intersectsNode(value: any) {
    return intersects(this.$impl, unwrap(value, "intersectsNode"));
  }
  createContextualFragment(html: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const start = this.$impl.startNode;
    const context = contextOf(start.type === ELEMENT ? start : (start.parent ?? start), start.doc);
    const fragment = hooks.parseFragment(context, String(html), false, true);
    react();
    return wrap(fragment);
  }
  getClientRects() {
    return rectList(rangeRects(this.$impl));
  }
  getBoundingClientRect() {
    return boundsOf(rangeRects(this.$impl));
  }
  expand(unit = "") {
    hooks.expandRange(this.$impl, `${unit}`);
  }
  toString() {
    return rangeText(this.$impl);
  }
}
expose(AbstractRange);
expose(StaticRange);
expose(OpaqueRange);
expose(Range, { START_TO_START: 0, START_TO_END: 1, END_TO_END: 2, END_TO_START: 3 });

function intersects(range: R, node: N): boolean {
  if (rootOf(node) !== rootOf(range.startNode)) return false;
  if (node.parent === null) return true;
  const index = indexOf(node);
  return (
    comparePoints(node.parent, index, range.endNode, range.endOffset) < 0 &&
    comparePoints(node.parent, index + 1, range.startNode, range.startOffset) > 0
  );
}

// ───────────────────────────── traversal ─────────────────────────────

const ACCEPT = 1;
const REJECT = 2;
const SKIP = 3;

class Traversal {
  root: N;
  whatToShow: number;
  filter: any;
  active = false;
  node: N;
  before = true;

  constructor(root: N, whatToShow: number, filter: any) {
    this.root = this.node = root;
    this.whatToShow = whatToShow >>> 0;
    this.filter = filter;
  }

  /** While the filter of an iterator runs. */
  candidate: { node: N; before: boolean } | null = null;

  test(node: N): number {
    if (this.active) throw domError("InvalidStateError", "Filter function can't be recursive");
    if (!(this.whatToShow & (1 << (node.type - 1)))) return SKIP;
    const { filter } = this;
    if (filter === null) return ACCEPT;
    this.active = true;
    try {
      return +($isCallable(filter) ? filter(wrap(node)) : filter.acceptNode(wrap(node)));
    } finally {
      this.active = false;
    }
  }

  iterate(forward: boolean) {
    if (this.active) this.test(this.node);
    const candidate = (this.candidate = { node: this.node, before: this.before });
    let node: N | null;
    do {
      node = candidate.node;
      if (candidate.before === forward) candidate.before = !forward;
      else if ((node = forward ? core.following(node, this.root) : core.preceding(node, this.root)) === null)
        return (this.candidate = null);
      candidate.node = node;
    } while (this.test(node) !== ACCEPT);
    this.node = candidate.node;
    this.before = candidate.before;
    this.candidate = null;
    return wrap(node);
  }

  children(first: boolean) {
    let node = first ? this.node.first : this.node.last;
    while (node !== null) {
      const result = this.test(node);
      if (result === ACCEPT) return wrap((this.node = node));
      const child = first ? node.first : node.last;
      if (result === SKIP && child !== null) {
        node = child;
        continue;
      }
      while ((first ? node.next : node.prev) === null) {
        node = node.parent!;
        if (node === null || node === this.root || node === this.node) return null;
      }
      node = first ? node.next : node.prev;
    }
    return null;
  }

  siblings(next: boolean) {
    let node = this.node;
    if (node === this.root) return null;
    while (true) {
      let sibling = next ? node.next : node.prev;
      while (sibling !== null) {
        node = sibling;
        const result = this.test(node);
        if (result === ACCEPT) return wrap((this.node = node));
        sibling = next ? node.first : node.last;
        if (result === REJECT || sibling === null) sibling = next ? node.next : node.prev;
      }
      node = node.parent!;
      if (!node || node === this.root || this.test(node) === ACCEPT) return null;
    }
  }
}

const traversal = {
  get root() {
    return wrap((this as any).$impl.root);
  },
  get whatToShow() {
    return (this as any).$impl.whatToShow;
  },
  get filter() {
    return (this as any).$impl.filter;
  },
};

class NodeIterator {
  declare $impl: Traversal;

  constructor() {
    core.illegalConstructor();
  }
  get referenceNode() {
    return wrap(this.$impl.node);
  }
  get pointerBeforeReferenceNode() {
    return this.$impl.before;
  }
  nextNode() {
    return this.$impl.iterate(true);
  }
  previousNode() {
    return this.$impl.iterate(false);
  }
  detach() {
    core.brand(this);
  }
}

class TreeWalker {
  declare $impl: Traversal;

  constructor() {
    core.illegalConstructor();
  }
  get currentNode() {
    return wrap(this.$impl.node);
  }
  set currentNode(node) {
    this.$impl.node = unwrap(node, "currentNode");
  }
  parentNode() {
    const walker: Traversal = this.$impl;
    for (let node: N | null = walker.node; node !== walker.root && (node = node.parent) !== null;) {
      if (walker.test(node) === ACCEPT) return wrap((walker.node = node));
    }
    return null;
  }
  firstChild() {
    return this.$impl.children(true);
  }
  lastChild() {
    return this.$impl.children(false);
  }
  previousSibling() {
    return this.$impl.siblings(false);
  }
  nextSibling() {
    return this.$impl.siblings(true);
  }
  previousNode() {
    const walker: Traversal = this.$impl;
    let node = walker.node;
    while (node !== walker.root) {
      for (let sibling = node.prev; sibling !== null; sibling = node.prev) {
        node = sibling;
        let result = walker.test(node);
        while (result !== REJECT && node.last !== null) result = walker.test((node = node.last));
        if (result === ACCEPT) return wrap((walker.node = node));
      }
      if (node === walker.root || node.parent === null) return null;
      node = node.parent!;
      if (walker.test(node) === ACCEPT) return wrap((walker.node = node));
    }
    return null;
  }
  nextNode() {
    const walker: Traversal = this.$impl;
    let node: N | null = walker.node;
    let result = ACCEPT;
    while (true) {
      node = (result !== REJECT ? node.first : null) ?? core.followingSkip(node, walker.root);
      if (node === null) return null;
      result = walker.test(node);
      if (result === ACCEPT) return wrap((walker.node = node));
    }
  }
}
core.mixin(traversal, NodeIterator, TreeWalker);
expose(NodeIterator);
expose(TreeWalker);

function NodeFilter() {
  core.illegalConstructor();
}
Object.assign(NodeFilter, { FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3, SHOW_ALL: 0xffffffff });
core
  .splitTokens(
    "ELEMENT ATTRIBUTE TEXT CDATA_SECTION ENTITY_REFERENCE ENTITY PROCESSING_INSTRUCTION COMMENT DOCUMENT DOCUMENT_TYPE DOCUMENT_FRAGMENT NOTATION",
  )
  .forEach((name, bit) => (NodeFilter["SHOW_" + name] = 1 << bit));
core.interfaces.NodeFilter = NodeFilter;

const collectedIterators = new FinalizationRegistry<[any, Traversal]>(([doc, it]) => doc.iterators.$delete(it));

function createTraversal(isWalker: boolean, root: N, whatToShow = 0xffffffff, filter = null) {
  const made = Object.create((isWalker ? TreeWalker : NodeIterator).prototype);
  made.$impl = new Traversal(root, whatToShow, filter);
  if (!isWalker) {
    root.doc.iterators.$add(made.$impl);
    collectedIterators.register(made, [root.doc, made.$impl]);
  }
  return made;
}

hooks.iteratorsBeforeRemove = (removed: N) => {
  for (const it of removed.doc.iterators as Set<Traversal>) {
    for (const pointer of [it, it.candidate]) {
      if (pointer === null || !core.contains(removed, pointer.node) || core.contains(removed, it.root)) continue;
      const next = pointer.before ? core.followingSkip(removed, it.root) : null;
      pointer.before = next !== null;
      pointer.node = next ?? core.preceding(removed, null)!;
    }
  }
};

// ───────────────────────────── selection ─────────────────────────────

/** Of a document. The range may be in the shadow tree of a control, where scripts do not see it. */
class S {
  doc: Doc;
  js: any = null;
  /** A `Range`. */
  range: any = null;
  /** A script has `range`. */
  isExposed = false;
  /** What is selected, if its ends are in different trees. */
  composed: R | null = null;
  isInShadow = false;
  /** Else scripts do not see into shadow trees. */
  isFromScript = false;
  backward = false;
  upstream = false;
  /** Where moving up and down aims at. */
  goalX = NaN;

  constructor(doc: Doc) {
    this.doc = doc;
  }

  get r(): R | null {
    return this.range === null ? null : this.range.$impl;
  }
  get span(): R | null {
    return this.composed ?? this.r;
  }
  get anchor(): [N, number] {
    const r = this.span!;
    return this.backward ? [r.endNode, r.endOffset] : [r.startNode, r.startOffset];
  }
  get focus(): [N, number] {
    const r = this.span!;
    return this.backward ? [r.startNode, r.startOffset] : [r.endNode, r.endOffset];
  }

  changed() {
    this.upstream = false;
    this.goalX = NaN;
    this.doc.page?.selectionChanged();
  }

  use(range: any, backward = false, isDifferent = true) {
    this.isExposed = this.isFromScript = false;
    this.composed?.detach();
    this.composed = null;
    this.isInShadow = range !== null && isInAuthorShadow(range.$impl.startNode);
    const ownRange = this.range;
    if (ownRange !== null) ownRange.$impl.selection = null;
    this.range = range;
    this.backward = backward;
    if (range !== null) range.$impl.selection = this;
    if (isDifferent) this.changed();
  }

  select(anchor: N, anchorOffset: number, focus: N = anchor, focusOffset = anchorOffset, upstream = false) {
    const backward = compareComposed(anchor, anchorOffset, focus, focusOffset) > 0;
    if (backward) [anchor, anchorOffset, focus, focusOffset] = [focus, focusOffset, anchor, anchorOffset];
    if (rootOf(anchor) !== rootOf(focus)) {
      this.use(rangeOf(focus, focusOffset, focus, focusOffset), backward);
      return this.compose(anchor, anchorOffset, focus, focusOffset);
    }
    const r = this.span;
    if (
      r === null ||
      r.startNode !== anchor ||
      r.startOffset !== anchorOffset ||
      r.endNode !== focus ||
      r.endOffset !== focusOffset ||
      backward !== this.backward ||
      upstream !== this.upstream
    ) {
      this.use(rangeOf(anchor, anchorOffset, focus, focusOffset), backward);
    } else if (this.isExposed) this.use(rangeOf(anchor, anchorOffset, focus, focusOffset), backward, false);
    this.upstream = upstream;
  }

  compose(startNode: N, startOffset: number, endNode: N, endOffset: number) {
    if (rootOf(startNode) === rootOf(endNode) || compareComposed(startNode, startOffset, endNode, endOffset) >= 0)
      return;
    (this.composed = new R(startNode)).put(startNode, startOffset, endNode, endOffset);
    this.composed.selection = this;
    this.isInShadow = true;
  }

  /** By a script. */
  rangeSet() {
    const { startNode } = this.r!;
    if (core.composedRoot(startNode) !== this.doc.node) return this.clear();
    if (this.composed !== null) this.changed();
    this.composed?.detach();
    this.composed = null;
    this.isInShadow = isInAuthorShadow(startNode);
  }

  /** The shadow trees in `removed` go with it. */
  leave(removed: N) {
    const ends = [this.anchor, this.focus];
    const moved = ends.map((it): [N, number] =>
      core.containsComposed(removed, it[0]) ? [removed.parent!, indexOf(removed)] : it,
    );
    if (moved[0] !== ends[0] || moved[1] !== ends[1]) this.select(...moved[0], ...moved[1]);
  }

  clear() {
    if (this.range !== null) this.use(null);
  }

  text(): string {
    const r = this.span;
    if (r === null || r.collapsed) return "";
    const control = core.outOfControl(r.startNode);
    const controlX = control.x;
    if (control !== r.startNode && controlX?.isText) return controlX.selectedText();
    return core.sync(this.doc).renderedText(...toEngine(r), true);
  }
}

function isInAuthorShadow(node: N): boolean {
  return (rootOf(core.outOfControl(node)).flags & SHADOW_ROOT) !== 0;
}

function selectionOf(doc: Doc): S {
  return (doc.selection ??= new S(doc));
}

/** The point that `scope`'s scripts see. */
function visiblePoint([node, offset]: [N, number], isEnd = false): [N, number] {
  const control = core.outOfControl(node);
  return control === node ? [node, offset] : [control.parent!, indexOf(control) + (isEnd ? 1 : 0)];
}

function selectionPoint(selection: S, value: any, offset: number, method: string): N | null {
  const node = unwrap(value, method);
  checkPoint(node, offset);
  return core.composedRoot(node) === selection.doc.node ? node : null;
}

function selectFromScript(selection: S, anchor: N, anchorOffset: number, focus = anchor, focusOffset = anchorOffset) {
  selection.select(anchor, anchorOffset, focus, focusOffset);
  selection.isFromScript = true;
  hooks.focusSelection(selection);
}

/** The anchor and the focus, as the scripts of a tree see them. */
function seen(js: Selection): [anchor: [N, number], focus: [N, number]] | null {
  const selection = js.$impl;
  const { r } = selection;
  const scope = js === selection.js ? selection.doc.node : scopes.get(js);
  if (r === null) return null;
  if (scope === selection.doc.node && (selection.isFromScript || !selection.isInShadow)) {
    const [start, end] = [visiblePoint([r.startNode, r.startOffset]), visiblePoint([r.endNode, r.endOffset])];
    return selection.backward ? [end, start] : [start, end];
  }
  const lift = ([node, offset]: [N, number]): [N, number] | null => {
    for (
      let root;
      (root = rootOf(node)) !== scope;
      [node, offset] = [core.hostOf(root).parent!, indexOf(core.hostOf(root))]
    ) {
      if (!(root.flags & SHADOW_ROOT)) return null;
    }
    return [node, offset];
  };
  const [anchor, focus] = [lift(selection.anchor), lift(selection.focus)];
  return anchor && focus && [anchor, focus];
}

function requireRange(selection: S): R {
  if (selection.r === null) throw domError("InvalidStateError", "There is no selection.");
  return selection.span!;
}

class Selection {
  declare $impl: S;

  constructor() {
    core.illegalConstructor();
  }
  get anchorNode() {
    const ends = seen(this);
    return ends && wrap(ends[0][0]);
  }
  get anchorOffset() {
    return seen(this)?.[0][1] ?? 0;
  }
  get focusNode() {
    const ends = seen(this);
    return ends && wrap(ends[1][0]);
  }
  get focusOffset() {
    return seen(this)?.[1][1] ?? 0;
  }
  get baseNode() {
    return this.anchorNode;
  }
  get baseOffset() {
    return this.anchorOffset;
  }
  get extentNode() {
    return this.focusNode;
  }
  get extentOffset() {
    return this.focusOffset;
  }
  get isCollapsed() {
    const ends = seen(this);
    return ends === null || (ends[0][0] === ends[1][0] && ends[0][1] === ends[1][1]);
  }
  get rangeCount() {
    return seen(this) === null ? 0 : 1;
  }
  get type() {
    const r = this.$impl.span;
    return seen(this) === null ? "None" : r!.collapsed ? "Caret" : "Range";
  }
  get direction() {
    const { span: r, backward } = this.$impl;
    return r === null || r.collapsed ? "none" : backward ? "backward" : "forward";
  }
  getRangeAt(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    const { r, range, backward } = this.$impl;
    const ends = seen(this);
    if (ends === null || index >>> 0 !== 0) throw domError("IndexSizeError", `${index} is not a valid index.`);
    const [start, end] = backward ? ends.toReversed() : ends;
    if (start[0] !== r!.startNode || end[0] !== r!.endNode) return rangeOf(...start, ...end);
    this.$impl.isExposed = true;
    return range;
  }
  getComposedRanges(options: any = undefined) {
    const r = this.$impl.span;
    const roots: any[] = [...(options?.shadowRoots ?? [])];
    if (roots.some(it => !(unwrap(it, "getComposedRanges").flags & SHADOW_ROOT))) {
      throw new TypeError("Failed to convert value to 'ShadowRoot'.");
    }
    if (r === null) return [];
    const lift = (node: N, offset: number, isEnd: boolean): [N, number] => {
      for (let root; (root = rootOf(node)).type !== DOCUMENT;) {
        if (roots.some(it => core.containsComposed(root, it.$impl))) break;
        offset = indexOf(core.hostOf(root)) + (isEnd ? 1 : 0);
        node = core.hostOf(root).parent!;
      }
      return [node, offset];
    };
    return [staticRange(...lift(r.startNode, r.startOffset, false), ...lift(r.endNode, r.endOffset, true))];
  }
  addRange(range: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    core.brand(this);
    const selection: S = this.$impl;
    if (this.rangeCount !== 0 || core.composedRoot(range.$impl.startNode) !== selection.doc.node) return;
    selection.use(range);
    selection.isExposed = selection.isFromScript = true;
    hooks.focusSelection(selection);
  }
  removeRange(range: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (!(range?.$impl instanceof R)) throw new TypeError("parameter 1 is not of type 'Range'.");
    if (range !== this.$impl.range) throw domError("NotFoundError", "The given range isn't in the selection.");
    this.$impl.clear();
  }
  removeAllRanges() {
    this.$impl.clear();
  }
  empty() {
    this.$impl.clear();
  }
  collapse(value: any, offset = 0) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (value == null) return this.$impl.clear();
    const node = selectionPoint(this.$impl, value, offset >>> 0, "collapse");
    if (node !== null) selectFromScript(this.$impl, node, offset >>> 0);
  }
  setPosition(value: any, offset = 0) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.collapse(value, offset);
  }
  collapseToStart() {
    const r = requireRange(this.$impl);
    selectFromScript(this.$impl, r.startNode, r.startOffset);
  }
  collapseToEnd() {
    const r = requireRange(this.$impl);
    selectFromScript(this.$impl, r.endNode, r.endOffset);
  }
  extend(value: any, offset = 0) {
    if (core.composedRoot(unwrap(value, "extend")) !== this.$impl.doc.node) return;
    const node = selectionPoint(this.$impl, value, offset >>> 0, "extend");
    requireRange(this.$impl);
    const [anchor, anchorOffset] = this.$impl.anchor;
    if (node !== null) selectFromScript(this.$impl, anchor, anchorOffset, node, offset >>> 0);
  }
  setBaseAndExtent(anchorNode: any, anchorOffset: number, focusNode: any, focusOffset: number) {
    if ($argumentCount() < 4) core.tooFew(4);
    core.brand(this);
    const anchor = selectionPoint(this.$impl, anchorNode, anchorOffset >>> 0, "setBaseAndExtent");
    const focus = selectionPoint(this.$impl, focusNode, focusOffset >>> 0, "setBaseAndExtent");
    if (anchor && focus) selectFromScript(this.$impl, anchor, anchorOffset >>> 0, focus, focusOffset >>> 0);
  }
  selectAllChildren(value: any) {
    if ($argumentCount() < 1) core.tooFew(1);
    const node = selectionPoint(this.$impl, value, 0, "selectAllChildren");
    if (node !== null) selectFromScript(this.$impl, node, 0, node, isData(node) ? 0 : lengthOf(node));
  }
  modify(alter = "", direction = "", granularity = "") {
    core.brand(this);
    hooks.modifySelection(
      this.$impl,
      `${alter}`.toLowerCase(),
      `${direction}`.toLowerCase(),
      `${granularity}`.toLowerCase(),
    );
  }
  deleteFromDocument() {
    this.$impl.range?.deleteContents();
  }
  containsNode(value: any, allowPartial = false) {
    const { r } = this.$impl;
    const node = unwrap(value, "containsNode");
    if (r === null || rootOf(node) !== rootOf(r.startNode)) return false;
    const [outer, start, end] = isData(node)
      ? [node, 0, lengthOf(node)]
      : [node.parent, indexOf(node), indexOf(node) + 1];
    if (outer === null) return false;
    const [first, last] = allowPartial ? [end, start] : [start, end];
    return (
      comparePoints(outer, first, r.startNode, r.startOffset) >= 0 &&
      comparePoints(outer, last, r.endNode, r.endOffset) <= 0
    );
  }
  toString() {
    return this.$impl.text();
  }
}
expose(Selection);

const ofShadowRoots = new WeakMap<N, Selection>();
const scopes = new WeakMap<Selection, N>();

/** For the scripts of the tree at `scope`. */
function wrapSelection(doc: Doc, scope: N = doc.node) {
  const selection = selectionOf(doc);
  let js = scope === doc.node ? selection.js : ofShadowRoots.get(scope);
  if (js != null) return js;
  js = Object.create(Selection.prototype);
  js.$impl = selection;
  if (scope === doc.node) selection.js = js;
  else {
    ofShadowRoots.set(scope, js);
    scopes.set(js, scope);
  }
  return js;
}

export default {
  commonAncestor,
  compareComposed,
  comparePoints,
  createRange,
  createTraversal,
  deleteContents: (range: R) => removeContents(range, Take.Delete),
  cloneContents: (r: R) => takeContents(r.startNode, r.startOffset, r.endNode, r.endOffset, Take.Clone),
  extractContents: (range: R) => removeContents(range, Take.Extract)!,
  fromEngine,
  insertNode,
  nodeAfter,
  opaqueRange,
  pointId,
  pointOffset,
  rangeOf,
  rangeRects,
  selectionOf,
  staticRange,
  toEngine,
  visiblePoint,
  wrapSelection,
};
