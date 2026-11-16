const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const { imageOfArea, parseInteger, scrollIntoView, styleBits } = require("internal/desktop/dom/html");
const { selectionOf } = require("internal/desktop/dom/range");

const { ELEMENT, HTML, SVG, flags, getAttr, hasAttr, hooks, isHtml, setState, states, wrapOrNull } = core;
const { CONNECTED, HOST, SHADOW_ROOT, SLOT, USER_AGENT } = flags;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;

const RENDERED = 1;
const IS_VISIBLE = 2;
const EDITABLE = 4;
const INERT = 16;
const SCROLLS = 32;
const SKIPPED = 16384;

const SCROLL_CONTROL = 2 ** 30;

function isEditingHost(node: N): boolean {
  if (!hasAttr(node, "contenteditable") && !(node.doc.designMode && node.parent === node.doc.node)) return false;
  return styleBits(node, EDITABLE) !== 0 && !(node.parent!.type === ELEMENT && styleBits(node.parent!, EDITABLE));
}

/** The outermost editable element around the node. */
function editingHost(node: N | null): N | null {
  let host: N | null = null;
  if (node !== null && node.type !== ELEMENT) node = node.parent;
  for (; node !== null && node.type === ELEMENT && styleBits(node, EDITABLE); node = node.parent) host = node;
  return host;
}

function isInert(node: N): boolean {
  const modal = hooks.topModal(node.doc);
  return (modal !== null && !core.containsFlat(modal, node)) || styleBits(node, INERT) !== 0;
}

function supportsFocus(node: N): boolean {
  if (node.type !== ELEMENT || node.flags & USER_AGENT || hooks.isDisabled(node)) return false;
  const index = parseInteger(getAttr(node, "tabindex"));
  if (index === index) return true;
  if (node.ns === SVG) return node.name === "a" && core.svgHref(node) !== null;
  if (node.ns !== HTML) return false;
  switch (node.name) {
    case "a":
    case "area":
      return hasAttr(node, "href");
    case "input":
      return node.x.type !== "hidden";
    case "select":
      return !hooks.isBaseListBox(node);
    case "button":
    case "textarea":
    case "iframe":
    case "frame":
    case "dialog":
      return true;
    case "object":
    case "embed":
      return hooks.frameOf(node) !== null;
    case "option":
      return hooks.isFocusableOption(node);
    case "audio":
    case "video":
      return hasAttr(node, "controls");
    case "summary":
      if (hooks.isDetailsSummary(node)) return true;
  }
  return isEditingHost(node);
}

function isReachable(node: N): boolean {
  if (node.name === "area") {
    const image = imageOfArea(node);
    return image !== null && isReachable(image) && !hasAttr(node, "inert");
  }
  const bits = styleBits(node, RENDERED | IS_VISIBLE | SKIPPED);
  return (bits === (RENDERED | IS_VISIBLE) || (!(bits & RENDERED) && isCanvasFallback(node))) && !isInert(node);
}

function isCanvasFallback(node: N): boolean {
  const canvas = core.closestHtml(node.parent, "canvas");
  if (canvas === null || !styleBits(canvas, RENDERED)) return false;
  const style = (of: N, name: string) => node.doc.engine.computedStyle(of.id, "", name);
  for (let at = node; at !== canvas; at = at.parent!)
    if (style(at, "display") === "none" || hasAttr(at, "inert")) return false;
  return style(node, "visibility") === "visible" && style(node, "display") !== "contents" && !isInert(canvas);
}

function delegatesFocus(node: N): boolean {
  return (node.flags & HOST) !== 0 && core.scopeOf(node.rare!.shadow!).delegatesFocus;
}

function isScroller(node: N): boolean {
  return node.type === ELEMENT && styleBits(node, SCROLLS) !== 0 && node.name !== "body" && node.name !== "html";
}

function isMouseFocusable(node: N): boolean {
  return supportsFocus(node) && !delegatesFocus(node) && isReachable(node);
}

function isFocusable(node: N): boolean {
  return (supportsFocus(node) || isScroller(node)) && !delegatesFocus(node) && isReachable(node);
}

function tabIndexOf(node: N): number {
  const index = parseInteger(getAttr(node, "tabindex"));
  return index === index
    ? index
    : (isHtml(node, "dialog") && !isEditingHost(node)) || hooks.isSkippedOption(node)
      ? -1
      : 0;
}

/** What gets the focus in place of a dialog, a popover or a shadow host. */
function focusDelegate(root: N): N | null {
  let first: N | null = null;
  const visit = (parent: N): N | null => {
    for (const node of core.elementChildren(parent)) {
      const wants = hasAttr(node, "autofocus");
      if (wants || first === null) {
        const isCandidate = isMouseFocusable(node) && (wants || !isHtml(root, "dialog") || tabIndexOf(node) >= 0);
        const area = isCandidate ? node : delegatesFocus(node) ? focusDelegate(node) : null;
        if (area !== null && wants) return area;
        first ??= area;
      }
      const found = visit(node);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(delegatesFocus(root) ? root.rare!.shadow! : root) ?? first;
}

function autofocusDelegate(root: N): N | null {
  for (let node = core.following(root, root); node !== null; node = core.following(node, root)) {
    if (!(node.flags & flags.AUTOFOCUS)) continue;
    const area = isMouseFocusable(node) ? node : delegatesFocus(node) ? focusDelegate(node) : null;
    if (area !== null) return area;
  }
  return null;
}

function markChain(node: N | null, on: boolean) {
  setState(node!, states.FOCUS, on && !node!.doc.page!.hasFocusedControl);
  if (!on && node!.doc.page?.hasFocusedControl) blurControl(node!.doc);
  let isWithin = on;
  for (let at = node; at !== null && at.type === ELEMENT; at = core.flatParent(at) ?? core.parentOrHost(at)) {
    setState(at, states.FOCUS_WITHIN, isWithin);
    if (isWithin && at.doc.topLayer.length > 0 && at.doc.topLayer.includes(at)) isWithin = false;
  }
  for (let root = core.rootOf(node!); root.flags & SHADOW_ROOT; root = core.rootOf(core.hostOf(root))) {
    setState(core.hostOf(root), states.FOCUS, on);
  }
}

function fireFocus(node: N, type: string, bubbling: string, related: N | null) {
  if (node.x?.isRemote) return;
  if (related?.x?.isRemote) related = null;
  const init = { view: node.doc.page!.window, relatedTarget: wrapOrNull(related), composed: true };
  events.dispatch(node, new events.FocusEvent(type, init));
  events.dispatch(node, new events.FocusEvent(bubbling, { ...init, bubbles: true }));
}

const isEditable = /^(?:true|plaintext-only|)$/i;

function takesText(node: N): boolean {
  if (node.x?.isText === true) return true;
  const editable = getAttr(node, "contenteditable");
  if (editable === null || !isEditable.test(editable) || node.doc.designMode) return isEditingHost(node);
  for (let at = node.parent; at !== null && at.type === ELEMENT; at = at.parent) {
    if (hasAttr(at, "contenteditable")) return isEditingHost(node);
  }
  return true;
}

const enum Cause {
  Script,
  Mouse,
  Keyboard,
}

/** False if a listener moved the focus elsewhere. */
function setFocus(doc: Doc, node: N | null, cause: Cause, visible?: boolean): boolean {
  const old: N | null = doc.focused;
  const { page } = doc;
  if (old === node) return true;
  const serial = ++page!.focusSerial;
  page!.tabStart = null;
  if (cause === Cause.Mouse) page!.hadKey = false;
  if (old !== null) {
    const wasVisible = (old.state & states.FOCUS_VISIBLE) !== 0;
    visible ??= cause === Cause.Script && wasVisible && !takesText(old) ? true : undefined;
    hooks.beforeBlur(old);
    if (serial !== page!.focusSerial) return false;
    doc.focused = null;
    markChain(old, false);
    setState(old, states.FOCUS_VISIBLE, false);
    old.x?.dates?.render();
    if (page!.isFocused) fireFocus(old, "blur", "focusout", node);
    if (serial !== page!.focusSerial) return false;
  }
  if (node !== null && node.flags & CONNECTED) {
    if (cause !== Cause.Script) page!.lastFocusWasMouse = cause === Cause.Mouse;
    page!.hidesFocus = visible === false;
    visible ??= takesText(node) || !page!.lastFocusWasMouse || page!.hadKey;
    doc.focused = node;
    markChain(node, true);
    setState(node, states.FOCUS_VISIBLE, visible!);
    node.x?.dates?.render();
    if (takesText(node) && page!.mouse.autoscrolls !== null) page!.mouse.onMove = page!.mouse.autoscrolls = null;
    if (cause !== Cause.Mouse) hooks.selectOnFocus(node, cause === Cause.Keyboard);
    if (page!.isFocused) fireFocus(node, "focus", "focusin", old);
  }
  page!.focusChanged();
  return serial === page!.focusSerial;
}

function noteKey(doc: Doc) {
  doc.page!.hadKey = true;
  if (doc.focused !== null && !doc.page!.hidesFocus && !doc.page!.hasFocusedControl)
    setState(doc.focused, states.FOCUS_VISIBLE, true);
}

function focus(node: N, cause: Cause, options?: { preventScroll?: boolean; focusVisible?: boolean }) {
  const { doc } = node;
  if (!(node.flags & CONNECTED) || doc.page === null) return;
  let target: N | null = node;
  if (node === core.documentElement(doc) && !supportsFocus(node)) target = null;
  else if (delegatesFocus(node)) {
    if (core.containsComposed(node, doc.focused)) return;
    if ((target = focusDelegate(node)) === null) return;
  } else if (!isFocusable(node)) {
    target = isHtml(node, "label") ? hooks.labeledControl(node) : null;
    if (target === null || !isFocusable(target)) return;
  }
  if (!setFocus(doc, target, cause, options?.focusVisible) || target === null || options?.preventScroll) return;
  if (!hooks.revealCaret(target)) scrollIntoView(target, 4, 4);
}

function focusOnMouseDown(doc: Doc, target: N | null) {
  let node = target;
  for (; node !== null && node.type === ELEMENT; node = core.flatParent(node)) {
    if (delegatesFocus(node)) {
      if (core.containsComposed(node, doc.focused)) return;
      node = focusDelegate(node);
      break;
    }
    if (isMouseFocusable(node)) break;
  }
  setFocus(doc, node?.type === ELEMENT ? node : null, Cause.Mouse);
  if (doc.focused === null) startTabbingAt(doc.page!, target);
}

/** The element that a scroll marker or a scroll button belongs to counts as focused in its place. */
function controlScrolling(doc: Doc, action: number, part: number): boolean {
  const page = doc.page!;
  if (action === 0) setFocus(doc, null, Cause.Mouse);
  const found = core.sync(doc).controlScrolling(action | 0, part | 0);
  core.invalidate(doc);
  if (found >= SCROLL_CONTROL) startTabbingAt(page, doc.nodes[found - SCROLL_CONTROL] ?? null);
  else if (found !== 0 && action === 0) {
    page.hasFocusedControl = true;
    setFocus(doc, doc.nodes[found]!, Cause.Mouse, false);
  }
  return found !== 0;
}

function blurControl(doc: Doc) {
  doc.page!.hasFocusedControl = false;
  doc.engine.controlScrolling(4, 0);
}

function startTabbingAt(page: Page, node: N | null, gap = 0) {
  page.tabStart = node;
  page.tabGap = gap;
}

function startTabbingInPlaceOf(node: N) {
  const parent = core.flatParent(node) ?? node.parent!;
  const previous =
    parent.flags & SLOT ? core.flatChildren(parent).at(core.flatChildren(parent).indexOf(node) - 1) : node.prev;
  const isFirst = previous == null || (parent.flags & SLOT && core.flatChildren(parent)[0] === node);
  startTabbingAt(node.doc.page!, isFirst ? parent : previous, isFirst ? 2 : 1);
}

/** The focus went with a node that was removed, or that can no longer have it. */
function dropFocus(doc: Doc, removed: N) {
  const old = doc.focused;
  doc.focused = null;
  doc.page!.focusSerial++;
  markChain(old, false);
  setState(old!, states.FOCUS_VISIBLE, false);
  startTabbingInPlaceOf(removed);
  doc.page!.focusChanged();
}

function fixUpFocus(doc: Doc) {
  const old = doc.focused;
  if (old === null || doc.page!.hasFocusedControl || isFocusable(old)) return;
  setFocus(doc, null, Cause.Script);
  startTabbingAt(doc.page!, old);
}

/** Something in the frame has got the focus. */
function focusFrame(node: N) {
  setFocus(node.doc, node, Cause.Mouse, false);
  node.doc.container?.focus();
}

function windowFocusChanged(page: Page) {
  const node = page.doc.focused;
  const event = new events.FocusEvent(page.isFocused ? "focus" : "blur", { view: page.window });
  if (page.focusedFrame !== null) return;
  if (!page.isFocused && node !== null) fireFocus(node, "blur", "focusout", null);
  events.dispatch(page.target, event);
  if (page.isFocused && node !== null && node === page.doc.focused) fireFocus(node, "focus", "focusin", null);
}

// ───────────────────────────── sequential navigation ─────────────────────────────

const CONTENTS = 64;
const RTL = 4096;
const READING_FLOW = 65536;

function itemsOf(parent: N): N[] {
  return core.flatChildren(parent).flatMap(it => (it.type === ELEMENT && styleBits(it, CONTENTS) ? itemsOf(it) : it));
}

/** https://drafts.csswg.org/css-display-4/#reading-flow */
function readingRanks(container: N): Map<N, number> | null {
  const engine = core.sync(container.doc);
  const value = (node: N, property: string) =>
    node.type === ELEMENT ? engine.computedStyle(node.id, "", property) : "";
  const [flow, display] = [value(container, "reading-flow"), value(container, "display")];
  if (flow === "source-order" ? display === "inline" : !display.includes(flow.slice(0, 4))) return null;
  const by = (property: string) => (a: N, b: N) => +value(a, property) - +value(b, property);
  const all = itemsOf(container);
  const isInFlow = (node: N) => !/^(?:absolute|fixed)$/.test(value(node, "position"));
  const items = all.filter(isInFlow);
  if (flow !== "source-order") items.sort(by("order"));
  if (flow === "flex-visual" || flow === "grid-rows" || flow === "grid-columns") {
    const mode = value(container, "writing-mode");
    const isRtl = styleBits(container, RTL) !== 0;
    const start = (node: N, isInline: boolean) => {
      const [x, y, width, height] = engine.boundingRect(node.id);
      const isReversed = isInline ? isRtl : mode.endsWith("-rl");
      if (isInline === (mode === "horizontal-tb")) return isReversed ? -x - width : x;
      return isReversed ? -y - height : y;
    };
    const isByColumn =
      flow === "grid-columns" || (flow === "flex-visual" && value(container, "flex-direction").startsWith("column"));
    items.sort(
      (a, b) =>
        Math.round(start(a, isByColumn) - start(b, isByColumn)) || start(a, !isByColumn) - start(b, !isByColumn),
    );
  }
  const ordered = [...items.sort(by("reading-order")), ...all.filter(it => !isInFlow(it)).sort(by("reading-order"))];
  return new Map(ordered.map((it, i) => [it, i]));
}

function inReadingOrder(parent: N, ranks: Map<N, number>): N[] {
  const withoutSlots = (it: N): N[] =>
    core.flatChildren(it).flatMap(it => (it.flags & SLOT && !ranks.$has(it) ? withoutSlots(it) : it));
  const rank = (node: N) =>
    ranks.$get(node) ?? itemsOf(node).reduce((least, it) => Math.min(least, ranks.$get(it)!), ranks.size);
  return withoutSlots(parent).sort((a, b) => rank(a) - rank(b));
}

/** Adds the stops in `owner`'s scope, and `marker`, which is one for this purpose. The document stands for a gap at the marker. */
function collectStops(owner: N, marker: N | null, gap: number, into: N[], ranks: Map<N, number> | null = null) {
  const entries: { index: number; stops: N[] }[] = [];
  const visit = (parent: N): boolean => {
    let hasStop = false;
    if (gap === 2 && parent === marker) entries.push({ index: 0, stops: [parent.doc.node] });
    for (const node of ranks === null ? core.flatChildren(parent) : inReadingOrder(parent, ranks)) {
      if (node.type !== ELEMENT) {
        if (node === marker) entries.push({ index: 0, stops: [gap === 0 ? node : node.doc.node] });
        continue;
      }
      if (node.rare?.popover?.invoker && node.rare.popover.invoker !== owner) continue;
      const bits = styleBits(node, RENDERED | CONTENTS | SCROLLS | READING_FLOW);
      if (!(bits & (RENDERED | 64)) && node !== marker && !core.containsFlat(node, marker) && node.name !== "area")
        continue;
      const index = ranks === null ? tabIndexOf(node) : Math.min(tabIndexOf(node), 0);
      const isStop = index >= 0 && isMouseFocusable(node) && !hooks.isSkippedRadio(node);
      const entry = { index: Math.max(index, 0), stops: isStop || (node === marker && gap === 0) ? [node] : [] };
      entries.push(entry);
      let hasInner = false;
      const inner = bits & CONTENTS ? ranks : bits & READING_FLOW ? readingRanks(node) : null;
      const isHostOrSlot = node.flags & (HOST | SLOT) && !(node.flags & USER_AGENT) && node.kind.shadow === null;
      if (isHostOrSlot || inner !== null || ranks !== null) {
        const before = entry.stops.length;
        if (index >= 0 || !isHostOrSlot || core.containsFlat(node, marker))
          collectStops(node, marker, gap, entry.stops, inner);
        hasInner = entry.stops.length > before;
      } else hasInner = visit(node);
      const popover = hooks.invokedPopover(node);
      if (popover !== null) {
        if (isMouseFocusable(popover) && tabIndexOf(popover) >= 0) entry.stops.push(popover);
        collectStops(popover, marker, gap, entry.stops);
      }
      if (!isStop && !hasInner && index >= 0 && entry.stops.length === 0 && bits & SCROLLS && isFocusable(node)) {
        entry.stops.push(node);
      }
      if (gap === 1 && node === marker) entries.push({ index: 0, stops: [node.doc.node] });
      hasStop ||= isStop || hasInner;
    }
    return hasStop;
  };
  visit(owner);
  entries.sort((a, b) => (a.index || Infinity) - (b.index || Infinity) || 0);
  for (const entry of entries) into.push(...entry.stops);
}

function moveFocus(doc: Doc, backward: boolean) {
  let marker: N | null = doc.focused ?? doc.page!.tabStart;
  if (marker !== null && !(marker.flags & CONNECTED)) marker = null;
  const stops: N[] = [];
  const gap = doc.focused === null && marker !== null ? doc.page!.tabGap : 0;
  collectStops(doc.node, marker, gap, stops);
  if (gap !== 0) marker = doc.node;
  const index = stops.indexOf(marker!);
  const candidates = stops.filter(node => node !== marker);
  let next = index < 0 ? (backward ? -1 : 0) : backward ? index - 1 : index;
  if (doc.container !== null && (candidates.length === 0 || (index >= 0 && (next < 0 || next >= candidates.length)))) {
    setFocus(doc, null, Cause.Keyboard);
    return doc.container.tab(backward);
  }
  if (candidates.length === 0) return;
  if (next >= candidates.length) next = 0;
  doc.page!.isTabbing = true;
  focus(candidates.at(next)!, Cause.Keyboard);
  doc.page!.isTabbing = false;
}

hooks.autofocusInserted = node => {
  const { page } = node.doc;
  const top = page?.topOfSameOrigin();
  if (!top || top.doc.hasAutofocused || page!.host.isSandboxed?.("allow-scripts")) return;
  top.autofocusCandidates = [...top.autofocusCandidates.filter(it => it !== node), node];
  core.invalidate(top.doc);
};

function endAutofocus(doc: Doc) {
  const top = doc.page?.topOfSameOrigin();
  if (!top) return;
  top.autofocusCandidates = [];
  top.doc.hasAutofocused = true;
}

/** https://html.spec.whatwg.org/#flush-autofocus-candidates */
function autofocus(page: Page) {
  const { doc } = page;
  if (doc.focused !== null || doc.hasAutofocused) return endAutofocus(doc);
  for (let node; (node = page.autofocusCandidates[0]) !== undefined; page.autofocusCandidates.shift()) {
    const own = node.doc.page;
    if (own === null || own.topOfSameOrigin() !== page) continue;
    if (own.blockingSheets.size > 0) return;
    if ([own, ...own.above()].some(it => it.same.$get("target"))) continue;
    const area = isMouseFocusable(node) ? node : delegatesFocus(node) ? focusDelegate(node) : null;
    if (area === null) continue;
    endAutofocus(doc);
    return focus(area, Cause.Script);
  }
}

hooks.markFocus = (doc, on) => markChain(doc.focused, on);
hooks.isEditingHost = isEditingHost;
hooks.focusFromScript = (node: N, options?: object) => focus(node, Cause.Script, options);
hooks.blur = (node: N) => {
  const { doc } = node;
  if (doc.focused === null || core.retarget(doc.focused, node) !== node) return;
  const old = doc.focused;
  setFocus(doc, null, Cause.Script);
  if (doc.page!.tabStart === null) startTabbingAt(doc.page!, old);
};
hooks.focusSelection = (selection: any) => {
  const { doc } = selection;
  const host = doc.page === null ? null : editingHost(selection.r.startNode);
  if (host === null || core.containsComposed(host, doc.focused) || !isMouseFocusable(host)) return;
  setFocus(doc, host, Cause.Mouse);
};

export default {
  KEYBOARD: Cause.Keyboard,
  startTabbingAt,
  startTabbingInPlaceOf,
  MOUSE: Cause.Mouse,
  SCRIPT: Cause.Script,
  autofocus,
  autofocusDelegate,
  dropFocus,
  editingHost,
  endAutofocus,
  fixUpFocus,
  focus,
  focusDelegate,
  focusFrame,
  focusOnMouseDown,
  controlScrolling,
  isFocusable,
  isInert,
  moveFocus,
  noteKey,
  setFocus,
  windowFocusChanged,
};
