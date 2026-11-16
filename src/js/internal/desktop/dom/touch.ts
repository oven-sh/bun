// Pens and fingers.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const input = require("internal/desktop/dom/input");
const { iterable, kList, makeList } = require("internal/desktop/dom/node");

const { expose, flags, sync } = core;

type N = $Dom.N;
type Page = $Dom.Page;
type Mouse = $Dom.Mouse;

const SLOP = 15;
const enum Pan {
  Left = 1,
  Right = 2,
  Up = 4,
  Down = 8,
  Zoom = 16,
  All = 31,
}
const pans = {
  "auto": Pan.All,
  "manipulation": Pan.All,
  "pan-x": 3,
  "pan-y": 12,
  "pan-left": 1,
  "pan-right": 2,
  "pan-up": 4,
  "pan-down": 8,
  "pinch-zoom": Pan.Zoom,
};

const measures = core.splitTokens("screenX screenY clientX clientY pageX pageY radiusX radiusY rotationAngle force");

class Touch {
  declare $impl: Record<string, any>;

  constructor(init: any) {
    const { identifier, target } = $isObject(init) ? init : ({} as any);
    if (identifier === undefined || !(target instanceof events.EventTarget)) {
      throw new TypeError("Failed to construct 'Touch': 'identifier' and 'target' are required.");
    }
    this.$impl = { identifier: identifier | 0, target };
    for (const name of measures) this.$impl[name] = events.finite(init[name] ?? 0);
  }
}
core.defineGetters(Touch, ["identifier", "target", ...measures], (self, name) => self.$impl[name]);
expose(Touch);

class TouchList {
  constructor() {
    core.illegalConstructor();
  }
  get length() {
    return this[kList].size();
  }
  item(index: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this[kList].at(index >>> 0) ?? null;
  }
}
iterable(expose(TouchList), false);

function listOf(given: any = []) {
  const touches = [...given];
  if (!touches.every(it => it instanceof Touch)) throw new TypeError("The value is not of type 'Touch'.");
  return makeList(TouchList, { size: () => touches.length, at: index => touches[index] });
}

const TouchEvent = events.simpleEvent(
  "TouchEvent",
  {
    touches: undefined,
    targetTouches: undefined,
    changedTouches: undefined,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
  },
  events.UIEvent,
  { touches: listOf, targetTouches: listOf, changedTouches: listOf },
);

class Finger {
  pointer: Mouse;
  identifier: number;
  target: N;
  pans: number;
  isScrolling = false;
  touch: any = null;

  constructor(pointer: Mouse, identifier: number, target: N) {
    this.pointer = pointer;
    this.identifier = identifier;
    this.target = target;
    this.pans = Pan.All;
    const engine = sync(target.doc);
    for (let at: N | null = target; at !== null && at.type === core.ELEMENT; at = core.flatParent(at)) {
      if (at.id === 0 || engine.computedStyle(at.id, "", "display") === "inline") continue;
      const value = engine.computedStyle(at.id, "", "touch-action");
      this.pans &= value.split(" ").reduce((all, it) => all | (pans[it] ?? 0), 0);
      if (engine.styleBits(at.id, 32)) break;
    }
  }
}

class Pointers {
  pen: Mouse | null = null;
  fingers = new Map<number, Finger>();
  nextId = 2;
  mayTap = false;
  /** A listener has canceled what would start scrolling. */
  isHandled = false;
  taps = 0;
  tappedAt = -Infinity;
}

const pointersOf = (page: Page): Pointers => (page.pointers ??= new Pointers());

function newPointer(page: Page, type: string): Mouse {
  const pointer = new input.Mouse();
  pointer.id = pointersOf(page).nextId++;
  pointer.type = type;
  return pointer;
}

function withPointer<T>(page: Page, pointer: Mouse, run: () => T): T {
  const { mouse } = page;
  page.mouse = pointer;
  page.systemMouse = mouse;
  try {
    return run();
  } finally {
    page.mouse = mouse;
    page.systemMouse = null;
  }
}

function pointerWithId(page: Page, id: number): Mouse | undefined {
  const { pen, fingers } = pointersOf(page);
  if (pen?.id === id) return pen;
  for (const { pointer } of fingers.values()) if (pointer.id === id) return pointer;
}

function handlePen(page: Page, event: any) {
  const pen = (pointersOf(page).pen ??= newPointer(page, "pen"));
  pen.details = event.details;
  withPointer(page, pen, () => input.handleMouse(page, event));
}

function place(page: Page, finger: Finger, point: any, modifiers: number) {
  const { pointer } = finger;
  input.place(page, { ...point, m: modifiers });
  pointer.isInside = true;
  pointer.details = point.details;
  const { x: clientX, y: clientY, screenX, screenY } = pointer;
  const { width = 1, height = 1, pressure = 1 } = point.details;
  finger.touch = new Touch({
    ...{
      identifier: finger.identifier,
      target: core.wrap(core.outOfControl(finger.target)),
      clientX,
      clientY,
      screenX,
      screenY,
    },
    ...{
      pageX: clientX + page.scroll(0),
      pageY: clientY + page.scroll(1),
      radiusX: width / 2,
      radiusY: height / 2,
      force: pressure,
    },
  });
}

/** One event for each target. False if one was canceled. */
function fireTouch(page: Page, type: string, changed: Finger[], m: number): boolean {
  if (!events.isListenedTo(type)) return true;
  const all = Array.from(pointersOf(page).fingers.values());
  const touchesOf = (fingers: Finger[]) => fingers.map(it => it.touch);
  let proceeds = true;
  for (const target of new Set(changed.map(it => it.target))) {
    const isOn = (finger: Finger) => finger.target === target;
    const isBlocking = type === "touchend" || events.hasBlockingListenerAbove(target, type);
    const event = new TouchEvent(type, {
      ...{ bubbles: true, composed: true, view: page.window },
      cancelable: type !== "touchcancel" && isBlocking && !changed.some(it => it.isScrolling),
      ...{
        touches: touchesOf(all),
        targetTouches: touchesOf(all.filter(isOn)),
        changedTouches: touchesOf(changed.filter(isOn)),
      },
      ...{ shiftKey: m & 1, ctrlKey: m & 2, altKey: m & 4, metaKey: m & 8 },
    });
    if (!events.dispatch(target, event)) proceeds = false;
  }
  return proceeds;
}

function lift(page: Page, { pointer, isScrolling }: Finger, type: string) {
  if (isScrolling) return;
  withPointer(page, pointer, () => {
    pointer.buttons = 0;
    const target = input.pointerTarget(page);
    pointer.details = { ...pointer.details, pressure: 0 };
    if (target !== null) input.firePointer(page, target, type, type === "pointerup" ? 0 : -1);
    pointer.pendingCapture = null;
    input.settleCapture(page);
    input.hover(page, null);
  });
}

function start(page: Page, point: any, m: number): Finger | null {
  const { fingers } = pointersOf(page);
  const target = input.elementAt(page, point.x / page.zoom, point.y / page.zoom);
  if (target === null) return null;
  const pointer = newPointer(page, "touch");
  const finger = new Finger(pointer, point.id, target);
  pointer.isPrimary = fingers.size === 0;
  pointer.fires = input.POINTER_EVENTS;
  fingers.$set(point.id, finger);
  withPointer(page, pointer, () => {
    place(page, finger, point, m);
    [pointer.pressX, pointer.pressY, pointer.buttons] = [pointer.x, pointer.y, 1];
    input.hover(page, target);
    pointer.pendingCapture = target;
    pointer.skipsMouseEvents = !input.firePointer(page, target, "pointerdown", 0);
  });
  return finger;
}

function pan(page: Page, finger: Finger, fromX: number, fromY: number) {
  const { pointer, target } = finger;
  if (!finger.isScrolling) {
    const [dx, dy] = [pointer.pressX - pointer.x, pointer.pressY - pointer.y];
    if (Math.hypot(dx, dy) <= SLOP) return;
    pointersOf(page).mayTap = false;
    const direction =
      pointersOf(page).fingers.size > 1
        ? Pan.Zoom
        : Math.abs(dx) > Math.abs(dy)
          ? dx < 0
            ? Pan.Left
            : Pan.Right
          : dy < 0
            ? Pan.Up
            : Pan.Down;
    if (pointersOf(page).isHandled || !(finger.pans & direction)) return void (finger.pans = 0);
    lift(page, finger, "pointercancel");
    finger.isScrolling = true;
  }
  const [dx, dy] = [finger.pans & 3 ? fromX - pointer.x : 0, finger.pans & 12 ? fromY - pointer.y : 0];
  if (!(target.flags & flags.CONNECTED)) return;
  if (sync(page.doc).userScroll(target.id, dx, dy, 0, false) === 0) page.container?.scroll(dx, dy);
  core.invalidate(page.doc);
}

function tap(page: Page, { pointer }: Finger, m: number) {
  const { mouse, zoom } = page;
  const pointers = pointersOf(page);
  const now = performance.now();
  pointers.taps = now - pointers.tappedAt < 400 ? pointers.taps + 1 : 1;
  pointers.tappedAt = now;
  const event = {
    x: pointer.x * zoom,
    y: pointer.y * zoom,
    sx: pointer.screenX,
    sy: pointer.screenY,
    m,
    b: 0,
    n: pointers.taps,
  };
  mouse.fires = input.MOUSE_EVENTS;
  mouse.tappedBy = pointer;
  for (const e of ["move", "down", "up"]) {
    mouse.skipsMouseEvents = pointer.skipsMouseEvents;
    input.handleMouse(page, { ...event, e, buttons: +(e === "down") });
  }
  mouse.fires = input.MOUSE_EVENTS | input.POINTER_EVENTS;
  mouse.tappedBy = null;
  mouse.isInside = false;
}

/** `points` are those that have changed. */
function handleTouch(page: Page, { e, points, m }: any) {
  const pointers = pointersOf(page);
  const { fingers } = pointers;
  if (e === "start") {
    if ((pointers.mayTap = fingers.size === 0 && points.length === 1)) pointers.isHandled = false;
    const started = points.map(point => start(page, point, m)).filter(Boolean);
    if (!fireTouch(page, "touchstart", started, m)) [pointers.isHandled, pointers.mayTap] = [true, false];
    return;
  }
  points = points.filter(point => fingers.$has(point.id));
  const changed: Finger[] = points.map(point => fingers.$get(point.id));
  if (e === "move") {
    const from = changed.map(({ pointer }) => [pointer.x, pointer.y]);
    changed.forEach((finger, index) =>
      withPointer(page, finger.pointer, () => {
        place(page, finger, points[index], m);
        const target = finger.isScrolling ? null : input.pointerTarget(page);
        if (target !== null) input.fireMove(page, target);
      }),
    );
    if (!fireTouch(page, "touchmove", changed, m)) [pointers.isHandled, pointers.mayTap] = [true, false];
    return changed.forEach((finger, index) => pan(page, finger, from[index][0], from[index][1]));
  }
  if (e === "end" && !changed.some(it => it.isScrolling)) page.noteUserActivation(true);
  for (const finger of changed) {
    lift(page, finger, e === "end" ? "pointerup" : "pointercancel");
    fingers.$delete(finger.identifier);
  }
  const proceeds = fireTouch(page, e === "end" ? "touchend" : "touchcancel", changed, m);
  if (e === "end" && proceeds && pointers.mayTap && changed.length === 1) tap(page, changed[0], m);
}

export default { handlePen, handleTouch, pointerWithId };
