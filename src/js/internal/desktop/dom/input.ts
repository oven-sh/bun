// From the events of the UI library to those of the DOM.
const dragCursors = { none: "no-drop", copy: "copy", link: "alias" };
const mediaTypes = { img: "image", video: "video", audio: "audio", canvas: "canvas" };

const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const editing = require("internal/desktop/dom/editing");
const focusing = require("internal/desktop/dom/focus");
const html = require("internal/desktop/dom/html");
const interactive = require("internal/desktop/dom/interactive");
const ranges = require("internal/desktop/dom/range");
const transfer = require("internal/desktop/dom/transfer");
const { isDisabled, textControl } = require("internal/desktop/dom/forms");
const { Element } = require("internal/desktop/dom/node");

const { ELEMENT, flags, flatParent, getAttr, hooks, isHtml, outOfControl, setState, states, sync } = core;
const { wrapOrNull } = core;
const { fromEngine, selectionOf } = ranges;
const { CONNECTED } = flags;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;
type Point = [N, number];
type DataTransfer = InstanceType<typeof transfer.DataTransfer>;

const isMac = process.platform === "darwin";
const POINTER = 1;
/** Among the modifiers: the library moves a scrollbar by itself. */
const COMPOSITOR_SCROLLS = 256;
const DRAG_DISTANCE = 4;
const SCROLL_PAUSE = 100;
const TOOLTIP_DELAY = 600;

type Drag = { source: N | null; data: DataTransfer; over: N | null; effect: string; movesSelection: boolean };

const POINTER_EVENTS = 1;
const MOUSE_EVENTS = 2;

/** Or a pen, or a finger. */
const WHEEL_GESTURE_GAP = 500;

class Mouse {
  id = POINTER;
  type = "mouse";
  isPrimary = true;
  fires = POINTER_EVENTS | MOUSE_EVENTS;
  /** Members of `PointerEventInit`. */
  details: any = null;
  /** The finger that it stands in for. */
  tappedBy: Mouse | null = null;
  lock: N | null = null;
  lockedAt: number[] | null = null;
  x = -1;
  y = -1;
  screenX = 0;
  screenY = 0;
  movementX = 0;
  movementY = 0;
  buttons = 0;
  modifiers = 0;
  isInside = false;
  /** The element under it and its ancestors, from the inside out. */
  hovered: N[] = [];
  /** What it was over has been removed. */
  hasLostTarget = false;
  pressed: N[] = [];
  isHoverCut = false;
  pressTarget: N | null = null;
  pressX = 0;
  pressY = 0;
  clicks = 0;
  capture: N | null = null;
  pendingCapture: N | null = null;
  /** `pointerdown` was canceled. */
  skipsMouseEvents = false;
  onScrollbar = false;
  scrollControl = 0;
  dragSource: N | null = null;
  mayDragSelection = false;
  drag: Drag | null = null;
  /** What follows it until the button is released. */
  onMove: ((x: number, y: number) => void) | null = null;
  onRelease: (() => void) | null = null;
  autoscrolls: N | null = null;
  cursor = "";
  /** The frame that is coming knows what it has to be. */
  isCursorStale = false;
  wheelTarget: N | null = null;
  wheelTime = 0;
  scrolledAt = -Infinity;
  hoverTimer: any = null;
  tooltipTimer: any = null;
  tooltipOf: N | null = null;
}
declare global {
  namespace $Dom {
    type Mouse = MouseImpl;
  }
}
type MouseImpl = Mouse;

function elementAt(page: Page, x: number, y: number): N | null {
  const { doc } = page;
  const found = doc.nodes[sync(doc).hitTest(x, y)];
  if (!found) return core.documentElement(doc);
  if (found.type !== ELEMENT) return flatParent(found);
  return found.name === "img" && core.hasAttr(found, "usemap") ? (html.areaAt(found, x, y) ?? found) : found;
}

/** What stands for `node` if a listener has removed it. */
function stillThere(page: Page, node: N): N | null {
  if (node.flags & CONNECTED && node.doc === page.doc) return node;
  return page.mouse.hovered[0] ?? core.documentElement(page.doc);
}

function chainOf(node: N | null): N[] {
  const chain: N[] = [];
  for (; node !== null && node.type === ELEMENT; node = flatParent(node) ?? node.parent) chain.push(node);
  return chain;
}

/** How many of them match `:hover` or `:active`, which end at the top layer. */
function reachOf(chain: N[]): number {
  const topLayer = chain[0]?.doc.topLayer;
  return (topLayer?.length > 0 && chain.findIndex(it => topLayer.includes(it)) + 1) || chain.length;
}

class MouseInit {
  bubbles: boolean;
  cancelable: boolean;
  composed: boolean;
  view: object;
  detail: number;
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  movementX = 0;
  movementY = 0;
  button: number;
  buttons: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  modifierBits: number;
  relatedTarget: object | null;
  pointerId = POINTER;
  pointerType = "mouse";
  isPrimary = true;
  pressure: number;
  deltaX = 0;
  deltaY = 0;
  dataTransfer: DataTransfer | null = null;

  constructor(page: Page, button: number, detail: number, related: N | null, bubbles: boolean) {
    const { mouse } = page;
    const { modifiers } = mouse;
    this.bubbles = this.cancelable = this.composed = bubbles;
    this.view = page.window;
    this.detail = detail;
    this.clientX = mouse.x;
    this.clientY = mouse.y;
    this.screenX = mouse.screenX;
    this.screenY = mouse.screenY;
    this.button = button;
    this.buttons = mouse.buttons;
    this.shiftKey = (modifiers & 1) !== 0;
    this.ctrlKey = (modifiers & 2) !== 0;
    this.altKey = (modifiers & 4) !== 0;
    this.metaKey = (modifiers & 8) !== 0;
    this.modifierBits = modifiers & 48;
    this.relatedTarget = wrapOrNull(related && outOfControl(related));
    this.pressure = mouse.buttons !== 0 ? 0.5 : 0;
    const { tappedBy } = mouse;
    if (mouse.id !== POINTER || tappedBy !== null) {
      const { id, type, isPrimary, details } = tappedBy ?? mouse;
      Object.assign(this, { pointerId: id, pointerType: type, isPrimary }, details);
    }
  }

  floor() {
    this.clientX = Math.floor(this.clientX);
    this.clientY = Math.floor(this.clientY);
    this.screenX = Math.floor(this.screenX);
    this.screenY = Math.floor(this.screenY);
  }

  withMovement(mouse: Mouse) {
    this.movementX = mouse.movementX;
    this.movementY = mouse.movementY;
  }
}

function firePointer(page: Page, target: N, type: string, button = -1, related: N | null = null, bubbles = true) {
  const isTimed = type === "pointerdown" || type === "pointerup" || type === "pointercancel";
  if (!isTimed && (bubbles ? !events.isListenedTo(type) : !events.isHeard(target, type))) return true;
  if (!(page.mouse.fires & POINTER_EVENTS)) return true;
  const init = new MouseInit(page, button, 0, related, bubbles);
  if (type === "pointermove") init.withMovement(page.mouse);
  else if (type.endsWith("capture")) init.cancelable = false;
  else if (type === "pointercancel") {
    init.cancelable = false;
    init.clientX = init.clientY = init.screenX = init.screenY = 0;
  } else if (type === "pointerrawupdate") {
    init.withMovement(page.mouse);
    init.cancelable = false;
  }
  return events.dispatch(target, new events.PointerEvent(type, init));
}

function fireMove(page: Page, target: N, button = -1) {
  if (events.isListenedTo("pointerrawupdate") && page.window.isSecureContext)
    firePointer(page, target, "pointerrawupdate", button);
  firePointer(page, target, "pointermove", button);
}

function mouseEvent(page: Page, type: string, button: number, detail: number, related: N | null, bubbles: boolean) {
  const init = new MouseInit(page, button, detail, related, bubbles);
  if (type === "mousemove") init.withMovement(page.mouse);
  init.floor();
  return new events.MouseEvent(type, init);
}

function fireBoundary(page: Page, target: N, type: string, related: N | null, bubbles: boolean) {
  if (bubbles ? events.isListenedTo(type) : events.isHeard(target, type)) {
    events.dispatch(target, mouseEvent(page, type, 0, 0, related, bubbles));
  } else if (bubbles) page.timing().count(type);
}

/** The path of the event ends below it. */
function disabledControlAbove(node: N | null): N | null {
  for (; node !== null; node = flatParent(node)) if (node.name !== "fieldset" && isDisabled(node)) return node;
  return null;
}

function isInDisabledControl(node: N | null): boolean {
  return disabledControlAbove(node) !== null;
}

/** What controls do with an event that was not canceled. */
function runHandlers(target: N, event: object): boolean {
  for (let node: N | null = target; node !== null; node = flatParent(node)) {
    if (node.kind.handle !== null && node.kind.handle(node, event, target)) return true;
  }
  return false;
}

function fireMouse(page: Page, target: N, type: string, button: number, detail: number): boolean {
  const { mouse } = page;
  if (type === "mousemove" && page.openPicker === null && !events.isListenedTo(type)) return true;
  const event = mouseEvent(page, type, button, detail, null, true);
  const disabled = type === "mousemove" ? null : disabledControlAbove(target);
  if (disabled !== null) return mouse.skipsMouseEvents || events.dispatchBelow(target, event, disabled);
  if (!mouse.skipsMouseEvents && !events.dispatch(target, event)) return false;
  return !runHandlers(target, event);
}

function hover(page: Page, target: N | null) {
  const { mouse } = page;
  const old = mouse.hovered;
  const previous = old.length > 0 ? old[0] : null;
  const { hasLostTarget } = mouse;
  if (previous === target && !hasLostTarget) return;
  mouse.hasLostTarget = false;
  const chain = (mouse.hovered = chainOf(target));
  let left = old.length;
  let entered = chain.length;
  while (left > 0 && entered > 0 && old[left - 1] === chain[entered - 1]) {
    left--;
    entered--;
  }
  if (mouse.fires & MOUSE_EVENTS) {
    for (let i = 0; i < left; i++) setState(old[i], states.HOVER, false);
    const reach = reachOf(chain);
    const count = mouse.isHoverCut || reach < chain.length ? chain.length : entered;
    for (let i = 0; i < count; i++) setState(chain[i], states.HOVER, i < reach);
    mouse.isHoverCut = reach < chain.length;
  }
  const leavesDocument = target === null;
  const isSame =
    !hasLostTarget && previous !== null && target !== null && outOfControl(previous) === outOfControl(target);
  for (let pass = 0; pass < 2 && !isSame; pass++) {
    if (!(mouse.fires & (pass + 1))) continue;
    const fire = (node: N, type: string, related: N | null, bubbles: boolean) =>
      pass === 0
        ? firePointer(
            page,
            node,
            "pointer" + type,
            mouse.type === "touch" && mouse.capture === null ? 0 : -1,
            related,
            bubbles,
          )
        : fireBoundary(page, node, "mouse" + type, related, bubbles);
    if (previous !== null && !hasLostTarget) fire(previous, "out", target, true);
    for (let i = 0; i < left; i++) fire(old[i], "leave", target, false);
    if (leavesDocument) fire(page.doc.node, "leave", null, false);
    else if (target.flags & CONNECTED) fire(target, "over", previous, true);
    if (previous === null) fire(page.doc.node, "enter", null, false);
    for (let i = entered - 1; i >= 0; i--) fire(chain[i], "enter", previous, false);
  }
  scheduleTooltip(page);
}

/** Before `removed` leaves the document. */
function forget(page: Page, removed: N) {
  const { mouse } = page;
  if (removed.state & states.HOVER || (mouse.isHoverCut && mouse.hovered.includes(removed))) {
    mouse.hovered = mouse.hovered.slice(mouse.hovered.indexOf(removed) + 1);
    mouse.hasLostTarget = true;
  }
  if (removed.state & states.ACTIVE) mouse.pressed = mouse.pressed.slice(mouse.pressed.indexOf(removed) + 1);
  if (mouse.lock !== null && core.containsComposed(removed, mouse.lock)) setPointerLock(page, null);
  if (mouse.pendingCapture !== null && core.containsComposed(removed, mouse.pendingCapture))
    mouse.pendingCapture = null;
}

function setCursor(page: Page, cursor: string) {
  if (cursor === page.mouse.cursor) return;
  page.mouse.cursor = cursor;
  page.native?.setCursor(page.container?.surface ?? page.surface, cursor);
}

function updateCursor(page: Page) {
  const { mouse } = page;
  if (page.frameUnderMouse !== null || (mouse.isCursorStale = page.doc.scheduled)) return;
  if (mouse.drag === null && mouse.onMove === null) setCursor(page, page.doc.engine.cursorAt(mouse.x, mouse.y));
}

function settleCapture(page: Page) {
  const { mouse } = page;
  const { capture, pendingCapture } = mouse;
  if (capture === pendingCapture) return;
  mouse.capture = null;
  if (capture !== null) {
    firePointer(page, capture.flags & CONNECTED ? capture : page.doc.node, "lostpointercapture");
  }
  if (pendingCapture === null || !(pendingCapture.flags & CONNECTED)) return;
  mouse.capture = pendingCapture;
  hover(page, pendingCapture);
  firePointer(page, pendingCapture, "gotpointercapture");
}

function pointerTarget(page: Page): N | null {
  settleCapture(page);
  const { mouse } = page;
  const { lock } = mouse;
  if (lock !== null) return lock;
  const target = mouse.capture ?? elementAt(page, mouse.x, mouse.y);
  hover(page, target);
  return target !== null && target.flags & CONNECTED ? target : elementAt(page, mouse.x, mouse.y);
}

/** After what is under the mouse may have changed. */
function refreshHover(page: Page) {
  const { mouse } = page;
  if (!mouse.isInside || mouse.drag !== null || mouse.onScrollbar || mouse.lock !== null) return;
  if (mouse.capture !== null && !(mouse.capture.flags & CONNECTED)) settleCapture(page);
  hover(page, mouse.capture ?? elementAt(page, mouse.x, mouse.y));
  updateCursor(page);
}

function refreshHoverAfterScroll(page: Page) {
  const { mouse } = page;
  const left = mouse.scrolledAt + SCROLL_PAUSE - performance.now();
  mouse.hoverTimer =
    left > 0 ? setTimeout(events.fromEventLoop, left + 1, refreshHoverAfterScroll, page).unref() : null;
  if (left <= 0) refreshHover(page);
}

/** What passes under the mouse while the user scrolls is not hovered. */
function afterPaint(page: Page, hasMoved: boolean) {
  const { mouse } = page;
  if (mouse.isCursorStale && mouse.isInside) {
    mouse.isCursorStale = false;
    if (page.frameUnderMouse === null && mouse.drag === null && mouse.onMove === null) {
      setCursor(page, page.doc.engine.cursorAt(mouse.x, mouse.y));
    }
  }
  if (hasMoved && mouse.isInside && mouse.hoverTimer === null) refreshHoverAfterScroll(page);
}

function pointerWithId(page: Page | null, id: number): Mouse | undefined {
  if (page === null) return;
  return id === POINTER
    ? (page.systemMouse ?? page.mouse)
    : require("internal/desktop/dom/touch").pointerWithId(page, id);
}

function mouseOf(node: N, pointerId: number): Mouse {
  const found = pointerWithId(node.doc.page, pointerId | 0);
  if (found === undefined) throw core.domError("NotFoundError", "No active pointer with the given id is found.");
  return found;
}

function setPointerLock(page: Page, node: N | null) {
  const mouse = page.systemMouse ?? page.mouse;
  if (mouse.lock === node) return;
  mouse.lock = node;
  mouse.lockedAt = null;
  mouse.pendingCapture = null;
  page.host.setPointerLock?.(node !== null);
  page.queueTask(() => events.fire(page.doc.node, "pointerlockchange", true));
}
hooks.exitPointerLock = page => setPointerLock(page, null);

core.mixin(
  {
    setPointerCapture(this: any, pointerId: number) {
      if ($argumentCount() < 1) core.tooFew(1);
      const mouse = mouseOf(this.$impl, pointerId);
      if (!this.isConnected || mouse.lock !== null)
        throw core.domError("InvalidStateError", "The element cannot capture it.");
      if (mouse.buttons !== 0) mouse.pendingCapture = this.$impl;
    },
    releasePointerCapture(this: any, pointerId: number) {
      if ($argumentCount() < 1) core.tooFew(1);
      const mouse = mouseOf(this.$impl, pointerId);
      if (mouse.pendingCapture === this.$impl) mouse.pendingCapture = null;
    },
    hasPointerCapture(this: any, pointerId: number) {
      if ($argumentCount() < 1) core.tooFew(1);
      return pointerWithId(this.$impl.doc.page, pointerId | 0)?.pendingCapture === this.$impl;
    },
    async requestPointerLock(this: any) {
      const node: N = this.$impl;
      const { page } = node.doc;
      const fail = (name: string, message: string) => {
        page?.queueTask(() => events.fire(page.doc.node, "pointerlockerror", true));
        throw core.domError(name, message);
      };
      if (page === null || !(node.flags & CONNECTED))
        return fail("WrongDocumentError", "The element is not in a window.");
      if (page.host.isSandboxed?.("allow-pointer-lock")) fail("SecurityError", "The frame is sandboxed.");
      if (page.mouse.lock === null && !page.isActive()) fail("NotAllowedError", "A user gesture is required.");
      setPointerLock(page, node);
      await new Promise<void>(resolve => page.queueTask(resolve));
    },
  },
  Element,
);

// ───────────────────────────── tooltips ─────────────────────────────

function scheduleTooltip(page: Page) {
  const { mouse } = page;
  const isOverFrame = mouse.hovered[0]?.x?.isRemote;
  const titled = (!isOverFrame && mouse.hovered.find(node => core.hasAttr(node, "title"))) || null;
  if (titled === mouse.tooltipOf) return;
  hideTooltip(page);
  mouse.tooltipOf = titled;
  if (titled === null || mouse.buttons !== 0) return;
  mouse.tooltipTimer = setTimeout(() => {
    const title = getAttr(titled, "title");
    if (title && titled.flags & CONNECTED) page.showBubbleAt(mouse.x, mouse.y + 20, title);
  }, TOOLTIP_DELAY);
}

function hideTooltip(page: Page) {
  clearTimeout(page.mouse.tooltipTimer);
  page.hideBubble();
}

// ───────────────────────────── selecting ─────────────────────────────

function pointAt(root: N, x: number, y: number): { point: Point; upstream: boolean } | null {
  const found = sync(root.doc).pointAt(root.id, x, y);
  if (found.length === 0 || found[0] === 0) return null;
  return { point: fromEngine(root.doc, found[0], found[1]), upstream: found[2] === 1 };
}

function expand(root: N, [node, offset]: Point, granularity: number): [Point, Point] {
  const { doc } = root;
  const found = doc.engine.expandPoint(root.id, ranges.pointId(node), ranges.pointOffset(node, offset), granularity);
  if (found.length === 0) {
    return [
      [node, offset],
      [node, offset],
    ];
  }
  return [fromEngine(doc, found[0], found[1]), fromEngine(doc, found[2], found[3])];
}

function isOverSelection(page: Page): boolean {
  const { mouse, doc } = page;
  const r = selectionOf(doc).span;
  if (r === null || r.collapsed) return false;
  const rects = sync(doc).rangeRects(...ranges.toEngine(r));
  for (let i = 0; i < rects.length; i += 4) {
    const [dx, dy] = [mouse.x - rects[i], mouse.y - rects[i + 1]];
    if (dx >= 0 && dx < rects[i + 2] && dy >= 0 && dy < rects[i + 3]) return true;
  }
  return false;
}

function startSelecting(page: Page, target: N, button: number) {
  const { mouse, doc } = page;
  const selection = selectionOf(doc);
  const bits = html.styleBits(target);
  const control = outOfControl(target);
  if (textControl(control) === null && (control !== target || isHtml(target, "button") || (bits & (512 | 4)) === 512)) {
    return;
  }
  if (isInDisabledControl(target) && textControl(control) !== null) return;
  if (!(target.flags & CONNECTED) || (!(bits & 4) && (isHtml(target, "canvas") || isHtml(target, "img")))) return;
  const isOver = isOverSelection(page);
  if (button !== 0 && isOver) return;
  if (isOver && mouse.clicks === 1 && !(mouse.modifiers & 1)) return void (mouse.mayDragSelection = true);
  if (!events.fire(control, "selectstart", true, true)) return;
  if ((bits & (1024 | 4)) === 1024) {
    let all = target;
    while (all.parent!.type === ELEMENT && html.styleBits(all.parent!) & 1024) all = all.parent!;
    return selection.select(all, 0, all, core.lengthOf(all));
  }
  const root = editing.selectionRoot(target);
  const hit = pointAt(root, mouse.x, mouse.y);
  if (hit === null) return selection.clear();
  const selectsWord = isMac && button === 2 && !mouse.pressed.some(it => isHtml(it, "a") && core.hasAttr(it, "href"));
  const granularity = selectsWord ? 0 : Math.min(mouse.clicks, 3) - 2;
  const around = (point: Point): [Point, Point] =>
    granularity < 0 ? [point, point] : expand(root, point, granularity);
  const extends_ =
    mouse.modifiers & 1 &&
    selection.r !== null &&
    editing.selectionRoot(selection.r.startNode) === root &&
    !mouse.pressed.some(it => isHtml(it, "a") && core.hasAttr(it, "href"));
  const [first, last] = extends_ ? [selection.anchor, selection.anchor] : around(hit.point);
  const extendTo = (x: number, y: number) => {
    const found =
      root.flags & CONNECTED && first[0].scope !== null && last[0].scope !== null ? pointAt(root, x, y) : null;
    if (found === null || outOfControl(found.point[0]) !== (root === control.x?.editor ? control : found.point[0]))
      return;
    const [start, end] = around(found.point);
    if (ranges.compareComposed(...start, ...first) < 0) selection.select(...last, ...start, found.upstream);
    else selection.select(...first, ...end, found.upstream);
  };
  extendTo(mouse.x, mouse.y);
  if (button !== 0) return;
  mouse.onMove = extendTo;
  mouse.autoscrolls = root === doc.node ? target : root;
}

/** Once per frame, while the mouse selects or drags beyond the edge of what scrolls. */
function autoscroll(page: Page) {
  const { mouse, doc } = page;
  let box = mouse.drag !== null ? mouse.drag.over : mouse.autoscrolls;
  if (box === null || !(box.flags & CONNECTED)) return;
  const origin = box;
  while (box !== null && box.type === ELEMENT && !(html.styleBits(box) & 32) && !box.rare?.pseudo)
    box = flatParent(box);
  const isViewport = box === null || box.type !== ELEMENT;
  const [left, top, width, height] = isViewport ? [0, 0, page.width, page.height] : html.boundingRect(box!);
  const margin = mouse.drag !== null || isViewport ? 20 : 0;
  const beyond = (at: number, start: number, size: number) =>
    Math.min(0, at - start - margin) + Math.max(0, at - start - size + margin);
  const [dx, dy] = [beyond(mouse.x, left, width), beyond(mouse.y, top, height)];
  if (dx === 0 && dy === 0) return;
  const id = isViewport ? origin.id : box!.id;
  const [x, y] = doc.engine.scrollMetrics(id);
  if (box?.rare?.pseudo) doc.engine.scrollTo(id, x + dx / 2, y + dy / 2, 1);
  else if (doc.engine.userScroll(id, dx / 2, dy / 2, 0, false) === 0) return;
  mouse.onMove?.(mouse.x, mouse.y);
  page.needsAnotherFrame = true;
}

// ───────────────────────────── dragging ─────────────────────────────

function fireDrag(page: Page, target: N, type: string, mode: number, related: N | null = null): boolean {
  const { data } = page.mouse.drag!;
  const init = new MouseInit(page, 0, 0, related, true);
  init.cancelable = type !== "dragleave" && type !== "dragend";
  init.dataTransfer = data;
  data.$impl.mode = mode;
  const result = events.dispatch(target, new events.DragEvent(type, init));
  data.$impl.mode = transfer.PROTECTED;
  return result;
}

function startDrag(page: Page) {
  const { mouse, doc } = page;
  const data = new transfer.DataTransfer();
  const store = data.$impl;
  const movesSelection = mouse.mayDragSelection;
  let source = mouse.dragSource;
  mouse.dragSource = null;
  mouse.mayDragSelection = false;
  store.effectAllowed = "uninitialized";
  if (movesSelection) {
    editing.putSelection(doc, store);
    source = outOfControl(selectionOf(doc).r!.startNode);
  } else {
    const url = getAttr(source!, isHtml(source, "img") ? "src" : "href");
    if (url !== null && (isHtml(source, "img") || isHtml(source, "a"))) {
      for (const type of ["text/plain", "text/uri-list"]) store.set(type, core.resolveUrl(doc, url) ?? url);
      store.set("text/html", hooks.serializeOuter(source!));
    }
  }
  mouse.drag = { source, data, over: null, effect: "none", movesSelection };
  const { x, y } = mouse;
  [mouse.x, mouse.y] = [mouse.pressX, mouse.pressY];
  const starts = fireDrag(page, source!, "dragstart", transfer.READ_WRITE);
  [mouse.x, mouse.y] = [x, y];
  if (!starts) return void (mouse.drag = null);
  const under = mouse.capture ?? mouse.hovered[0];
  if (under !== undefined) firePointer(page, under, "pointercancel");
  mouse.pendingCapture = mouse.onMove = mouse.onRelease = null;
  settleCapture(page);
  release(mouse);
  hover(page, null);
}

function defaultEffect({ data, movesSelection }: Drag, modifiers: number): string {
  const allowed = data.$impl.effectAllowed.toLowerCase();
  if (allowed === "none" || allowed === "link" || allowed === "move") return allowed;
  if (allowed === "linkmove") return "link";
  return movesSelection && allowed === "uninitialized" && !(modifiers & (isMac ? 4 : 2)) ? "move" : "copy";
}

function acceptsText(target: N, { data }: Drag): boolean {
  if (data.$impl.get("text/plain") === "") return false;
  return textControl(outOfControl(target))?.isMutable() ?? (html.styleBits(target) & 4) !== 0;
}

function dragOver(page: Page) {
  const { mouse } = page;
  const drag = mouse.drag!;
  const store = drag.data.$impl;
  store.dropEffect = "none";
  if (drag.source !== null && !fireDrag(page, drag.source, "drag", transfer.PROTECTED)) return endDrag(page, false);
  const isOutside = mouse.x < 0 || mouse.y < 0 || mouse.x >= page.width || mouse.y >= page.height;
  const target = isOutside ? null : elementAt(page, mouse.x, mouse.y);
  const previous = drag.over;
  if (target !== previous) {
    drag.over = target;
    store.dropEffect = defaultEffect(drag, mouse.modifiers);
    if (target !== null) fireDrag(page, target, "dragenter", transfer.PROTECTED, previous);
    if (previous !== null && previous.flags & CONNECTED)
      fireDrag(page, previous, "dragleave", transfer.PROTECTED, target);
  }
  drag.effect = "none";
  if (target !== null) {
    store.dropEffect = defaultEffect(drag, mouse.modifiers);
    if (!fireDrag(page, target, "dragover", transfer.PROTECTED)) {
      const allowed = store.effectAllowed.toLowerCase();
      const isAllowed = allowed === "all" || allowed === "uninitialized" || allowed.includes(store.dropEffect);
      if (isAllowed) drag.effect = store.dropEffect;
    } else if (acceptsText(target, drag)) drag.effect = defaultEffect(drag, mouse.modifiers);
  }
  setCursor(page, dragCursors[drag.effect] ?? "grabbing");
  core.invalidate(page.doc);
}

function dropText(page: Page, target: N, drag: Drag) {
  const { mouse, doc } = page;
  const hit = pointAt(editing.selectionRoot(target), mouse.x, mouse.y);
  if (hit === null || (drag.movesSelection && isOverSelection(page))) return;
  const mark = ranges.rangeOf(...hit.point, ...hit.point).$impl;
  const control = textControl(outOfControl(target));
  let offset = hit.point[1];
  if (drag.movesSelection && drag.effect === "move") {
    if (control !== null && control.node === drag.source && offset > control.end) offset -= control.end - control.start;
    editing.deleteDragged(doc);
  }
  focusing.focusOnMouseDown(doc, target);
  if (control !== null) control.select(offset, offset);
  else selectionOf(doc).select(mark.startNode, mark.startOffset);
  drag.data.$impl.mode = transfer.READ_ONLY;
  editing.insertTransfer(doc, drag.data, "insertFromDrop", false);
}

function endDrag(page: Page, drops: boolean) {
  const { mouse } = page;
  const drag = mouse.drag!;
  const store = drag.data.$impl;
  const { over, source } = drag;
  if (over !== null && over.flags & CONNECTED) {
    store.dropEffect = drag.effect;
    if (!drops || drag.effect === "none") fireDrag(page, over, "dragleave", transfer.PROTECTED);
    else if (!fireDrag(page, over, "drop", transfer.READ_ONLY)) drag.effect = store.dropEffect;
    else if (acceptsText(over, drag)) dropText(page, over, drag);
    else drag.effect = "none";
  }
  store.dropEffect = drops ? drag.effect : "none";
  if (source !== null) fireDrag(page, source, "dragend", transfer.PROTECTED);
  store.mode = transfer.DISABLED;
  mouse.drag = null;
  refreshHover(page);
}

function handleFileDrag(page: Page, event: any) {
  const { mouse } = page;
  if (event.e !== "leave") place(page, event);
  if (mouse.drag === null) {
    if (event.e === "leave" || event.paths.length === 0) return;
    const data = new transfer.DataTransfer();
    for (const path of event.paths) data.$impl.addFile(page.host.fileFromPath(path));
    data.$impl.effectAllowed = "all";
    mouse.drag = { source: null, data, over: null, effect: "none", movesSelection: false };
  }
  if (event.e !== "leave") dragOver(page);
  const eventE = event.e;
  if (eventE === "leave" || eventE === "drop") endDrag(page, eventE === "drop");
}

// ───────────────────────────── the mouse ─────────────────────────────

/** Only the movement counts. */
function placeLocked(mouse: Mouse, event: any, screenX: number, screenY: number) {
  const [lastX, lastY] = mouse.lockedAt ?? [mouse.screenX, mouse.screenY];
  mouse.movementX = screenX - lastX;
  mouse.movementY = screenY - lastY;
  mouse.lockedAt = [screenX, screenY];
  mouse.modifiers = event.m;
}

function place(page: Page, event: any) {
  const { mouse, zoom } = page;
  const screenX = event.sx ?? event.x;
  const screenY = event.sy ?? event.y;
  mouse.movementX = mouse.isInside ? screenX - mouse.screenX : 0;
  mouse.movementY = mouse.isInside ? screenY - mouse.screenY : 0;
  if (mouse.lock !== null) return placeLocked(mouse, event, screenX, screenY);
  mouse.screenX = screenX;
  mouse.screenY = screenY;
  mouse.x = event.x / zoom;
  mouse.y = event.y / zoom;
  mouse.modifiers = event.m;
}

/** The mouse is over a frame, which has the cursor and the events. */
function enterFrame(page: Page, event: any, frame: N) {
  place(page, event);
  page.mouse.isInside = true;
  page.mouse.cursor = "";
  hover(page, frame);
}

function release(mouse: Mouse) {
  for (const node of mouse.pressed) setState(node, states.ACTIVE, false);
  mouse.pressed = [];
}

/** There is no click, and nothing follows the mouse. */
const RESIZER = 0x80000000;
const SCROLL_CONTROL = 2 ** 30;

function startResizing(page: Page, node: N) {
  const { mouse, doc } = page;
  const { x, y } = mouse;
  const cursor = doc.engine.cursorAt(x, y);
  const cssom = require("internal/desktop/dom/cssom");
  const { width, height } = cssom.computedStyle(node, "") as any;
  const style = cssom.styleOf(node);
  mouse.onScrollbar = true;
  mouse.onMove = (toX, toY) => {
    const dx = html.styleBits(node) & 4096 ? x - toX : toX - x;
    if (cursor !== "ns-resize") style.setProperty("width", Math.max(15, Math.round(parseFloat(width) + dx)) + "px");
    if (cursor !== "ew-resize")
      style.setProperty("height", Math.max(15, Math.round(parseFloat(height) + toY - y)) + "px");
  };
}

function abandonPress(page: Page) {
  const { mouse } = page;
  if (mouse.onScrollbar) page.doc.engine.scrollbarMouse(2, mouse.x, mouse.y);
  mouse.onScrollbar = mouse.mayDragSelection = false;
  mouse.dragSource = mouse.onMove = mouse.onRelease = mouse.autoscrolls = null;
  release(mouse);
}

function mouseMove(page: Page) {
  const { mouse, doc } = page;
  if (mouse.modifiers & COMPOSITOR_SCROLLS) return;
  // A menu or the window manager got the release.
  if (mouse.buttons === 0 && mouse.pressed.length > 0 && mouse.drag === null) abandonPress(page);
  const isOnScrollbar = sync(doc).scrollbarMouse(0, mouse.x, mouse.y) !== 0;
  if (doc.engine.pending() !== 0 || doc.engine.isAnimating()) core.invalidate(doc);
  if (mouse.onScrollbar) return mouse.onMove?.(mouse.x, mouse.y);
  if (mouse.dragSource !== null || mouse.mayDragSelection) {
    if (Math.hypot(mouse.x - mouse.pressX, mouse.y - mouse.pressY) >= DRAG_DISTANCE) startDrag(page);
  }
  if (mouse.drag !== null) return dragOver(page);
  const target = pointerTarget(page);
  if (target === null) return;
  fireMove(page, target);
  const left = stillThere(page, target);
  if (left !== null) fireMouse(page, left, "mousemove", 0, 0);
  if (mouse.onMove !== null) {
    mouse.onMove(mouse.x, mouse.y);
    core.invalidate(doc);
  } else if (isOnScrollbar) setCursor(page, "default");
  else updateCursor(page);
}

function contextMenu(page: Page, target: N) {
  const init = new MouseInit(page, 2, 0, null, true);
  init.floor();
  const event = new events.PointerEvent("contextmenu", init);
  if (!events.dispatch(target, event)) return;
  const misspelledWord = page.spelling === null ? "" : require("internal/desktop/dom/spelling").selectMisspelling(page);
  const params = describePoint(page, page.mouse.x, page.mouse.y);
  if (misspelledWord === "") return page.host.contextMenu?.(params);
  const show = (dictionarySuggestions: string[]) =>
    page.isDisposed ||
    page.host.contextMenu?.({ ...params, misspelledWord, dictionarySuggestions, spellcheckEnabled: true });
  page.native.request("spelling.guess", misspelledWord).then(show, () => show([]));
}

function mouseDown(page: Page, button: number, isFirst: boolean) {
  const { mouse, doc } = page;
  page.noteUserActivation(true);
  hideTooltip(page);
  if (mouse.drag !== null || mouse.modifiers & COMPOSITOR_SCROLLS) return;
  let target = pointerTarget(page);
  if (target === null) return;
  const picker = page.openPicker;
  if (picker !== null && !core.containsFlat(picker.node, target)) return picker.close();
  page.endComposition();
  const bar = button === 0 ? doc.engine.scrollbarMouse(1, mouse.x, mouse.y) : 0;
  if (bar >= RESIZER) return startResizing(page, doc.nodes[bar - RESIZER]!);
  mouse.scrollControl = bar >= SCROLL_CONTROL ? bar - SCROLL_CONTROL : 0;
  const scroller = mouse.scrollControl === 0 ? doc.nodes[bar] : null;
  if (scroller) {
    mouse.onScrollbar = true;
    core.invalidate(doc);
    target = scroller.type === ELEMENT ? scroller : core.documentElement(doc)!;
  }
  const isControlClick = isMac && button === 0 && mouse.modifiers === 2;
  release(mouse);
  mouse.pressed = chainOf((mouse.pressTarget = target));
  const active = mouse.pressed.slice(0, reachOf(mouse.pressed));
  const labeled = active.find(it => it.name === "label");
  const control = labeled === undefined ? null : hooks.labeledControl(labeled);
  if (control !== null) for (const list of [active, mouse.pressed]) list.unshift(control);
  mouse.pressX = mouse.x;
  mouse.pressY = mouse.y;
  for (const node of active) setState(node, states.ACTIVE, true);
  if (button === 0) interactive.lightDismiss(page, target, true, mouse.x, mouse.y);
  if (mouse.tappedBy === null) {
    if (isFirst) mouse.skipsMouseEvents = !firePointer(page, target, "pointerdown", button);
    else fireMove(page, target, button);
  }
  if ((target = stillThere(page, target)) === null) return;
  if (fireMouse(page, target, "mousedown", button, mouse.clicks) && !scroller && !mouse.skipsMouseEvents) {
    if (!(target.flags & CONNECTED) || target.doc !== doc) target = elementAt(page, mouse.x, mouse.y)!;
    if (mouse.scrollControl !== 0) return selectionOf(doc).clear();
    const { selectionSerial } = page;
    const owner = outOfControl(target);
    focusing.focusOnMouseDown(doc, target);
    if (!(target.flags & CONNECTED) && owner.flags & CONNECTED) target = elementAt(page, mouse.x, mouse.y)!;
    const selected = selectionSerial === page.selectionSerial ? null : selectionOf(doc).r;
    if (
      selected?.collapsed === false &&
      outOfControl(selected.startNode) === outOfControl(target) &&
      textControl(doc.focused) !== null
    )
      return;
    if (button === 0 && textControl(outOfControl(target)) === null) {
      mouse.dragSource = mouse.pressed.find(html.isDraggable) ?? null;
    }
    if (mouse.onMove === null && mouse.dragSource === null && target.flags & CONNECTED) {
      startSelecting(page, target, isControlClick ? 2 : button);
    }
  }
  if (isControlClick) abandonPress(page);
  if ((button === 2 || isControlClick) && process.platform !== "win32" && target.flags & CONNECTED)
    contextMenu(page, target);
}

function mouseUp(page: Page, button: number) {
  const { mouse, doc } = page;
  if (mouse.drag !== null) return endDrag(page, true);
  const { pressed, onScrollbar, onRelease, mayDragSelection, clicks } = mouse;
  const wasSelecting = mouse.autoscrolls !== null && mouse.onMove !== null;
  if (onScrollbar) {
    doc.engine.scrollbarMouse(2, mouse.x, mouse.y);
    core.invalidate(doc);
  }
  const control =
    mouse.scrollControl !== 0 &&
    doc.engine.scrollbarMouse(2, mouse.x, mouse.y) === mouse.scrollControl + SCROLL_CONTROL;
  mouse.onScrollbar = mouse.mayDragSelection = false;
  mouse.dragSource = mouse.onMove = mouse.onRelease = mouse.autoscrolls = null;
  const target = pointerTarget(page);
  const captured = mouse.capture;
  release(mouse);
  if (target === null) return;
  if (mouse.buttons === 0) firePointer(page, target, "pointerup", button);
  else fireMove(page, target, button);
  const left = stillThere(page, target);
  const proceeds = left === null || fireMouse(page, left, "mouseup", button, clicks);
  onRelease?.();
  if (mouse.buttons === 0) {
    mouse.pendingCapture = null;
    mouse.skipsMouseEvents = false;
    settleCapture(page);
  }
  if (mayDragSelection) {
    const hit = pointAt(editing.selectionRoot(target), mouse.x, mouse.y);
    if (hit !== null) selectionOf(doc).select(...hit.point);
  }
  if (process.platform === "linux") {
    if (wasSelecting) editing.offerSelection(doc);
    else if (button === 1 && proceeds) editing.paste(doc, true, "selection");
  }
  const clicked = captured ?? pressed.find(node => core.containsFlat(node, target));
  if (button === 0 && pressed[0] === mouse.pressTarget) interactive.lightDismiss(page, target, false, mouse.x, mouse.y);
  if (clicked !== undefined && clicked.flags & CONNECTED && !onScrollbar) {
    const disabled = disabledControlAbove(clicked);
    const init = new MouseInit(page, button, clicks, null, true);
    init.floor();
    const click = new events.PointerEvent(button === 0 ? "click" : "auxclick", init);
    events.dispatchBelow(clicked, click, button === 0 ? disabled : null);
    if (control && !click.defaultPrevented) focusing.controlScrolling(doc, 0, mouse.scrollControl);
    if (button === 0 && clicks === 2)
      events.dispatchBelow(clicked, mouseEvent(page, "dblclick", 0, 2, null, true), disabled);
  }
  if (button === 2 && process.platform === "win32" && target.flags & CONNECTED) contextMenu(page, target);
  if (proceeds && (button === 3 || button === 4)) page.traverse(button === 3 ? -1 : 1);
  refreshHover(page);
}

function handleMouse(page: Page, event: any) {
  page.mouse.wheelTarget = null;
  const { mouse } = page;
  if (event.e === "leave") {
    if (event.x !== undefined) place(page, event);
    mouse.isInside = false;
    page.doc.engine.scrollbarMouse(3, 0, 0);
    core.invalidate(page.doc);
    if (mouse.buttons === 0) hover(page, null);
    return;
  }
  const isFirst = mouse.buttons === 0;
  place(page, event);
  mouse.isInside = true;
  mouse.buttons = event.buttons;
  if (event.e === "move") return mouseMove(page);
  if (event.e === "up") return mouseUp(page, event.b);
  mouse.clicks = event.n;
  mouseDown(page, event.b, isFirst);
}

/** The events of one gesture have the same one. */
function wheelTarget(page: Page): N | null {
  const { mouse } = page;
  const now = performance.now();
  const last = mouse.wheelTarget;
  const goesOn =
    last !== null &&
    mouse.movementX === 0 &&
    mouse.movementY === 0 &&
    now - mouse.wheelTime < WHEEL_GESTURE_GAP &&
    last.id !== 0 &&
    last.doc === page.doc;
  mouse.wheelTime = now;
  return goesOn ? last : (mouse.wheelTarget = elementAt(page, mouse.x, mouse.y));
}

/** The rest of the gesture is for the page, also once a frame gets under the mouse. */
function isScrollingPage({ mouse }: Page) {
  return mouse.wheelTarget !== null && performance.now() - mouse.wheelTime < WHEEL_GESTURE_GAP;
}

function scrollAround(page: Page, frame: N, x: number, y: number) {
  const { mouse } = page;
  if (sync(frame.doc).userScroll(frame.id, x, y, 0, false) === 0) return void page.container?.scroll(x, y);
  mouse.wheelTarget = frame;
  mouse.wheelTime = mouse.scrolledAt = performance.now();
  core.invalidate(frame.doc);
}

function handleWheel(page: Page, event: any) {
  const { mouse, doc } = page;
  place(page, event);
  mouse.isInside = true;
  const isPinch = event.t === "pinch";
  let dx = isPinch ? 0 : event.dx / page.zoom;
  let dy = isPinch ? -100 * event.delta : event.dy / page.zoom;
  if (dx === 0 && dy === 0) return;
  if (isPinch) mouse.modifiers |= 2;
  else if (mouse.modifiers & 1 && dx === 0) [dx, dy] = [dy, 0];
  const target = wheelTarget(page);
  if (target === null) return;
  hideTooltip(page);
  if (events.isListenedTo("wheel") || events.isListenedTo("mousewheel")) {
    const init = new MouseInit(page, 0, 0, null, true);
    init.deltaX = dx;
    init.deltaY = dy;
    init.cancelable =
      !event.isHandled &&
      (events.hasBlockingListenerAbove(target, "wheel") || events.hasBlockingListenerAbove(target, "mousewheel"));
    if (!events.dispatch(target, new events.WheelEvent("wheel", init))) return;
  }
  if (event.isHandled || mouse.modifiers & 2 || !(target.flags & CONNECTED)) return;
  if (sync(doc).userScroll(target.id, dx, dy, 0, !event.precise) === 0) return page.container?.scroll(dx, dy);
  mouse.scrolledAt = performance.now();
  core.invalidate(doc);
}

/** What a context menu needs to know. */
function describePoint(page: Page, x: number, y: number) {
  const { doc } = page;
  const chain = chainOf(elementAt(page, x, y));
  const target = outOfControl(chain[0]);
  const link = chain.find(node => isHtml(node, "a") && core.hasAttr(node, "href"));
  const resolve = (node: N | undefined, name: string) =>
    (node && core.resolveUrl(doc, getAttr(node, name) ?? "")) ?? "";
  const mediaType = mediaTypes[target.name] ?? "none";
  const can = (name: string) => editing.isEnabled(doc, name);
  const isEditable = editing.editTarget(doc) !== null && core.containsFlat(editing.editTarget(doc)!, target);
  return {
    x: Math.round(x * page.zoom),
    y: Math.round(y * page.zoom),
    pageURL: doc.url,
    linkURL: resolve(link, "href"),
    linkText: link ? core.textContent(link) : "",
    srcURL: core.hasAttr(target, "src") ? resolve(target, "src") : "",
    mediaType,
    hasImageContents: mediaType === "image",
    altText: getAttr(target, "alt") ?? "",
    titleText: getAttr(target, "title") ?? "",
    selectionText: selectionOf(doc).text(),
    isEditable,
    inputFieldType: textControl(target)?.type ?? "none",
    editFlags: {
      canUndo: can("undo"),
      canRedo: can("redo"),
      canCut: can("cut"),
      canCopy: can("copy"),
      canPaste: isEditable && page.host.clipboard?.availableFormats?.().length !== 0,
      canDelete: can("cut"),
      canSelectAll: true,
      canEditRichly: isEditable && textControl(target) === null,
    },
  };
}

// ───────────────────────────── the keyboard ─────────────────────────────

const keyCodes: Record<string, number | undefined> = {
  __proto__: null as any,
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  NumpadEnter: 13,
  Pause: 19,
  CapsLock: 20,
  Escape: 27,
  Space: 32,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  AltLeft: 18,
  AltRight: 18,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  PrintScreen: 44,
  Insert: 45,
  Delete: 46,
  MetaLeft: 91,
  MetaRight: isMac ? 93 : 92,
  ContextMenu: 93,
  NumpadMultiply: 106,
  NumpadAdd: 107,
  NumpadSubtract: 109,
  NumpadDecimal: 110,
  NumpadDivide: 111,
  NumLock: 144,
  ScrollLock: 145,
  Semicolon: 186,
  Equal: 187,
  Comma: 188,
  Minus: 189,
  Period: 190,
  Slash: 191,
  Backquote: 192,
  BracketLeft: 219,
  Backslash: 220,
  BracketRight: 221,
  Quote: 222,
  IntlBackslash: 226,
};

function keyCodeOf(key: string, code: string): number {
  if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^(?:Key|Digit).$/.test(code)) return code.charCodeAt(code.length - 1);
  if (/^F\d+$/.test(code)) return 111 + +code.slice(1);
  if (/^Numpad\d$/.test(code) && key.length === 1) return 96 + +key;
  return keyCodes[key] ?? keyCodes[code] ?? 0;
}

function keyTarget(doc: Doc): N | null {
  return doc.focused ?? core.bodyOf(doc) ?? core.documentElement(doc);
}

function keyEvent(page: Page, type: string, { key, code, location, repeat, m }: any, keyCode: number, charCode = 0) {
  return new events.KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: page.window,
    key,
    code,
    location,
    repeat,
    keyCode,
    charCode,
    isComposing: page.composition !== null,
    shiftKey: m & 1,
    ctrlKey: m & 2,
    altKey: m & 4,
    metaKey: m & 8,
    modifierBits: m & 48,
  });
}

function isPressedWithSpace(node: N): boolean {
  if (isHtml(node, "input")) return !node.x.isText && node.x.type !== "range";
  return isHtml(node, "button") || hooks.isDetailsSummary(node);
}

function isPressedWithEnter(node: N): boolean {
  if (isHtml(node, "input")) return isPressedWithSpace(node) && node.x.type !== "checkbox" && node.x.type !== "radio";
  return isPressedWithSpace(node) || (node.name === "a" && core.hasAttr(node, "href"));
}

function scrollByKey(page: Page, target: N, { key, shiftKey, altKey, ctrlKey, metaKey }: any): boolean {
  const unit = isMac && metaKey ? 3 : isMac && altKey ? 2 : 1;
  if (ctrlKey ? key !== "Home" && key !== "End" : !isMac && (altKey || metaKey)) return false;
  const step = {
    ArrowUp: [0, -1, unit],
    ArrowDown: [0, 1, unit],
    ArrowLeft: [-1, 0, 1],
    ArrowRight: [1, 0, 1],
    PageUp: [0, -1, 2],
    PageDown: [0, 1, 2],
    Home: [0, -1, 3],
    End: [0, 1, 3],
    " ": [0, shiftKey ? -1 : 1, 2],
  }[key];
  if (step === undefined) return false;
  const start = page.doc.focused === null ? page.tabStart : null;
  const from = start !== null && start.flags & CONNECTED && start.id !== 0 ? start : target;
  core.invalidate(page.doc);
  return sync(page.doc).userScroll(from.id, step[0], step[1], step[2], true) !== 0;
}

function pressEnter(page: Page, native: any): boolean {
  const target = keyTarget(page.doc)!;
  const isLineFeed = !isMac && (native.m & 2) !== 0;
  const event = keyEvent(page, "keypress", native, isLineFeed ? 10 : 13, isLineFeed ? 10 : 13);
  if (!events.dispatch(target, event)) return true;
  if (isLineFeed && target.name !== "a") return false;
  if (runHandlers(target, event)) return true;
  if (!isPressedWithEnter(target)) {
    return editing.typingTarget(page.doc) !== null && editing.insertBreak(page.doc, !event.shiftKey);
  }
  const { shiftKey, ctrlKey, altKey, metaKey } = event;
  html.click(target, true, { shiftKey, ctrlKey, altKey, metaKey });
  return true;
}

const controlKeys = { __proto__: null, Enter: 1, " ": 1, ArrowLeft: 2, ArrowUp: 2, ArrowRight: 3, ArrowDown: 3 };

function defaultKeyDown(page: Page, target: N, event: any, native: any): boolean {
  const { doc, mouse } = page;
  const { key } = event;
  if (runHandlers(target, event)) return true;
  if (doc.page!.hasFocusedControl && key in controlKeys) return focusing.controlScrolling(doc, controlKeys[key], 0);
  if (key === "Enter") return !(isMac ? event.metaKey : event.altKey) && pressEnter(page, native);
  if (key === "Tab") {
    if (event.ctrlKey || event.altKey || event.metaKey) return false;
    focusing.moveFocus(doc, event.shiftKey);
    return true;
  }
  if (key === "Escape" && mouse.lock !== null) setPointerLock(page, null);
  if (key === "Escape") return interactive.closeTopmost(page);
  if (key === "ContextMenu" || (key === "F10" && event.shiftKey && !isMac)) {
    const [left, top, width, height] = html.boundingRect(target);
    [mouse.x, mouse.y] = [left + width / 2, top + height / 2];
    contextMenu(page, target);
    return true;
  }
  return editing.handleKey(doc, event) || (key !== " " && scrollByKey(page, target, event));
}

function handleKey(page: Page, native: any) {
  const { doc, host, mouse } = page;
  const isDown = native.e === "down";
  page.pressedKey = null;
  mouse.modifiers = native.m;
  if (host.beforeInput?.(native)) return page.native?.keyHandled();
  const target = keyTarget(doc);
  if (target === null) return;
  const isForInputMethod = native.composing || native.key === "Process" || native.key === "Dead";
  const keyCode = isDown && isForInputMethod ? 229 : keyCodeOf(native.key, native.code);
  const event = keyEvent(page, isDown ? "keydown" : "keyup", native, keyCode);
  if (!isDown) {
    const wasPressed = native.key === " " && target.state & states.ACTIVE && isPressedWithSpace(target);
    if (wasPressed) setState(target, states.ACTIVE, false);
    if (events.dispatch(target, event) && wasPressed) html.click(target, true);
    return;
  }
  if (mouse.drag !== null) return void (native.key === "Escape" && endDrag(page, false));
  if (keyCode === 27) {
    if (interactive.exitFullscreenFully(page)) return page.native?.keyHandled();
  } else if (keyCode > 18 || keyCode < 16) page.noteUserActivation(false);
  hideTooltip(page);
  if (!(native.m & (2 | 4 | 8)) && keyCode !== 17 && keyCode !== 18 && keyCode !== 91 && keyCode !== 92)
    focusing.noteKey(doc);
  if (!events.dispatch(target, event)) return page.native?.keyHandled();
  if (isForInputMethod) return;
  if (defaultKeyDown(page, keyTarget(doc)!, event, native)) return page.native?.keyHandled();
  page.pressedKey = native;
  if (native.key.length > 2 || native.m & (2 | 4 | 8)) host.unhandledKey?.(native);
}

function handleText(page: Page, { text, key, range }: any) {
  const native = page.pressedKey;
  page.pressedKey = null;
  if (key && page.composition === null) {
    if (native === null) return;
    const target = keyTarget(page.doc)!;
    const code = text.charCodeAt(0);
    const event = keyEvent(page, "keypress", native, code, code);
    if (!events.dispatch(target, event) || runHandlers(target, event)) return;
    if (text === " " && isPressedWithSpace(target)) return setState(target, states.ACTIVE, true);
    if (text === " " && editing.typingTarget(page.doc) === null) return void scrollByKey(page, target, event);
  }
  editing.type(page, text, range);
}

function cancelGestures(page: Page) {
  page.openPicker?.close();
  hideTooltip(page);
}

export default {
  isScrollingPage,
  scrollAround,
  MOUSE_EVENTS,
  Mouse,
  POINTER_EVENTS,
  autoscroll,
  cancelGestures,
  describePoint,
  elementAt,
  enterFrame,
  fireMove,
  firePointer,
  forget,
  handleFileDrag,
  handleKey,
  handleMouse,
  handleText,
  handleWheel,
  hover,
  place,
  pointAt,
  pointerTarget,
  settleCapture,
  afterPaint,
};
