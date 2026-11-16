// The UI library (src/runtime/desktop/mod.rs). packages/bun-desktop/src/app.rs has the commands.
const nativeLoad = $bindgen("desktop.bind.ts", "load");
const nativeCall = $bindgen("desktop.bind.ts", "call");
const nativePost = $bindgen("desktop.bind.ts", "post");
const nativeDrainNumbers = $bindgen("desktop.bind.ts", "drainNumbers");
const nativeDrain = $bindgen("desktop.bind.ts", "drain");
const drainMicrotasks = $bindgen("desktop.bind.ts", "drainMicrotasks");
const nativeWait = $bindgen("desktop.bind.ts", "wait");
const nativePresent = $bindgen("desktop.bind.ts", "present");
const nativePutBlob = $bindgen("desktop.bind.ts", "putBlob");
const nativeTakeBlob = $bindgen("desktop.bind.ts", "takeBlob");
const nativeKeepAlive = $bindgen("desktop.bind.ts", "keepAlive");
const findChrome = $bindgen("desktop.bind.ts", "findChrome");
const mapResource = $bindgen("desktop.bind.ts", "mapResource");
const resourcesPath = $bindgen("desktop.bind.ts", "resourcesPath");

type NativeEvent = { t: string; [key: string]: any };
type Settle = (event: NativeEvent) => void;

let loaded = false;
let started = false;
let nextReply = 1;
let holds = 0;
let dispatching = false;
const replies = new Map<number, Settle>();
const handlers: Record<string, (event: NativeEvent) => void> = Object.create(null);
/** In milliseconds. */
const display = { frameInterval: 1000 / 60 };
const options = {
  get headless() {
    return process.env.BUN_DESKTOP_HEADLESS === "1";
  },
  accessory: false,
  composited: process.env.BUN_DESKTOP_COMPOSITOR !== "0",
};
/** What happens often arrives as numbers, and the rest goes to `handlers`. Positions are in the surface's pixels. */
const hooks = {
  started() {},
  /** After each event: the next one has to reach the handlers that close over the new state. */
  render() {},
  frame(_surface: number, _time: number) {},
  resize(_surface: number, _width: number, _height: number, _scale: number) {},
  /**
   * `action` is 0 for a move, 1 for down, 2 for up and 3 for leaving. `modifiers` has 256 while the renderer drags the
   * thumb of a scrollbar.
   */
  mouse(
    _surface: number,
    _x: number,
    _y: number,
    _screenX: number,
    _screenY: number,
    _modifiers: number,
    _action: number,
    _button: number,
    _buttons: number,
    _clicks: number,
  ) {},
  /** `phase` is 0 at the start, 1 for a move, 2 at the end and 3 if it was cancelled. */
  wheel(
    _surface: number,
    _x: number,
    _y: number,
    _screenX: number,
    _screenY: number,
    _modifiers: number,
    _deltaX: number,
    _deltaY: number,
    _isPrecise: boolean,
    _phase: number,
    _isHandled: boolean,
  ) {},
  /** The renderer has scrolled `node` that far in all. It is out of date if the scroller has another `generation`. */
  scroll(_surface: number, _node: number, _x: number, _y: number, _hasEnded: boolean, _generation: number) {},
  pinch(_surface: number, _x: number, _y: number, _modifiers: number, _delta: number, _phase: number) {},
  key(
    _surface: number,
    _isDown: boolean,
    _key: string,
    _code: string,
    _location: number,
    _isRepeat: boolean,
    _modifiers: number,
    _isComposing: boolean,
  ) {},
  /** `isTyped`: the key that went down last produced it. It replaces `start..end`, or the selection for -1. */
  text(_surface: number, _text: string, _isTyped: boolean, _start: number, _end: number) {},
};

// `Kind` in packages/bun-desktop/src/bridge.rs
const enum Kind {
  Json,
  Frame,
  Resize,
  Mouse,
  Wheel,
  Pinch,
  Key,
  Text,
  Scroll,
  Handled,
}

const enum Post {
  Frame,
  Cursor,
  KeyHandled,
}

// Records of `[kind, length, ...fields]`.
const incoming = new Float64Array(1024);
let queue = new Float64Array(2048);
let head = 0;
let tail = 0;
let waits = 0;
let objects: NativeEvent[] = [];
const names: string[] = [];
const pendingFrames = new Set<number>();

function reserve(count: number) {
  if (tail + count <= queue.length) return;
  const larger = new Float64Array(queue.length * 2);
  larger.set(queue);
  queue = larger;
}

function receive() {
  let count: number;
  while ((count = nativeDrainNumbers(incoming)) > 0) {
    reserve(count);
    let hasObjects = false;
    for (let i = 0; i < count; i++) queue[tail + i] = incoming[i];
    for (let at = tail; at < tail + count; at += queue[at + 1]) {
      if (queue[at] !== Kind.Json) continue;
      queue[at + 2] += objects.length;
      hasObjects = true;
    }
    tail += count;
    if (!hasObjects) continue;
    for (const event of JSON.parse(nativeDrain()) as NativeEvent[]) {
      if (event.t === "name") names.push(event.text);
      objects.push(event);
    }
  }
}

function name(value: number): string {
  return value < 0 ? String.fromCodePoint(-value) : names[value];
}

function deliver(at: number) {
  const q = queue;
  const kind = q[at];
  const surface = q[at + 2];
  q[at] = Kind.Handled;
  switch (kind) {
    case Kind.Json:
      return handlers[objects[surface].t]?.(objects[surface]);
    case Kind.Frame:
      if (pendingFrames.$delete(surface)) release();
      display.frameInterval = q[at + 4];
      return hooks.frame(surface, q[at + 3]);
    case Kind.Resize:
      return hooks.resize(surface, q[at + 3], q[at + 4], q[at + 5]);
    case Kind.Mouse:
      return hooks.mouse(
        surface,
        q[at + 3],
        q[at + 4],
        q[at + 5],
        q[at + 6],
        q[at + 7],
        q[at + 8],
        q[at + 9],
        q[at + 10],
        q[at + 11],
      );
    case Kind.Wheel:
      return hooks.wheel(
        surface,
        q[at + 3],
        q[at + 4],
        q[at + 5],
        q[at + 6],
        q[at + 7] & 255,
        q[at + 8],
        q[at + 9],
        q[at + 10] !== 0,
        q[at + 11],
        q[at + 7] >= 256,
      );
    case Kind.Scroll:
      return hooks.scroll(surface, q[at + 3], q[at + 4], q[at + 5], q[at + 6] !== 0, q[at + 7]);
    case Kind.Pinch:
      return hooks.pinch(surface, q[at + 3], q[at + 4], q[at + 7], q[at + 8], q[at + 9]);
    case Kind.Key:
      return hooks.key(
        surface,
        q[at + 3] !== 0,
        name(q[at + 4]),
        name(q[at + 5]),
        q[at + 6],
        q[at + 7] !== 0,
        q[at + 8],
        q[at + 9] !== 0,
      );
    case Kind.Text:
      return hooks.text(surface, name(q[at + 3]), true, -1, -1);
  }
}

function dispatch(at: number) {
  try {
    deliver(at);
  } catch (error) {
    reportError(error);
  }
}

// JSON.stringify escapes a lone surrogate, which is not text that the UI can hold.
const loneSurrogate = /(?<!\\)((?:\\\\)*)\\ud[89a-f][0-9a-f]{2}/g;
function encode(value: unknown): string {
  const json = JSON.stringify(value);
  return json.includes("\\ud") ? json.replace(loneSurrogate, "$1�") : json;
}

function execute(command: string, argument: unknown, reply?: number, ignoresResult?: boolean): any {
  const result = nativeCall(encode([command, argument ?? null, reply, ignoresResult]));
  if (result === "") return null;
  const { error, value } = JSON.parse(result);
  if (error !== undefined) throw new Error(error);
  return value;
}

/** Enough for fonts, images, canvases and surfaces that are in no window. Needs no display. */
function loadRenderer() {
  if (loaded) return;
  nativeLoad(onEvents);
  loaded = true;
}

/** Has other threads load what the first window needs, while this one runs the app's modules. */
function prewarm() {
  loadRenderer();
  if (!options.headless) execute("prewarm", null, undefined, true);
}

let isWarm = false;

/** A script may import the modules without showing anything, where there is no library to load. */
function prewarmIfPackaged() {
  if (isWarm || resourcesPath() === null) return;
  isWarm = true;
  try {
    prewarm();
  } catch {}
}

/** The app does not notice, and this thread does not wait. */
function startWith(command: string, argument: unknown) {
  loadRenderer();
  execute("start", options, undefined, true);
  execute(command, argument, undefined, true);
}

function start() {
  if (started) return;
  loadRenderer();
  execute("start", options);
  if (options.accessory) execute("activationPolicy", "accessory");
  started = true;
  hooks.started();
}

const needsNoDisplay = /^(?:(?:surface|font|image|canvas|defaults|keychain)\.|image$)/;
function prepare(command: string) {
  if (started) return;
  if (needsNoDisplay.test(command)) loadRenderer();
  else start();
}

function send(command: string, argument?: unknown) {
  prepare(command);
  try {
    execute(command, argument, undefined, true);
  } catch (error) {
    process.emitWarning((error as Error).message, "DesktopWarning");
  }
}

function ask(command: string, argument?: unknown): any {
  prepare(command);
  return execute(command, argument);
}

function sendWithReply(command: string, argument: unknown, settle: Settle) {
  prepare(command);
  const id = nextReply++;
  try {
    execute(command, argument, id);
  } catch (error) {
    return settle({ t: "reply", id, error: (error as Error).message });
  }
  replies.$set(id, settle);
  hold();
}

function request(command: string, argument?: unknown): Promise<any> {
  const { promise, resolve, reject } = Promise.withResolvers();
  sendWithReply(command, argument, reply =>
    reply.error !== undefined ? reject(new Error(reply.error)) : resolve(reply.value),
  );
  return promise;
}

function requestSync(command: string, argument?: unknown): any {
  let reply: NativeEvent | undefined;
  sendWithReply(command, argument, event => (reply = event));
  waitUntil(
    () => reply !== undefined,
    event => event.t === "reply",
  );
  const { error } = reply!;
  if (error !== undefined) throw new Error(error);
  return reply!.value;
}

/** One call of `hooks.frame` before the surface is next drawn. */
function requestFrame(surface: number) {
  if (pendingFrames.$has(surface)) return;
  nativePost(Post.Frame, surface, 0);
  pendingFrames.$add(surface);
  hold();
}

function destroySurface(surface: number) {
  if (pendingFrames.$delete(surface)) release();
  send("surface.destroy", { id: surface });
}

// In the order of `set_cursor` in packages/bun-desktop/src/surface.rs
const cursors = new Map<string, number>();
"default pointer text vertical-text crosshair|cell grab grabbing|move|all-scroll not-allowed|no-drop alias copy context-menu col-resize row-resize w-resize e-resize n-resize s-resize ew-resize ns-resize nwse-resize|nw-resize|se-resize nesw-resize|ne-resize|sw-resize none"
  .split(" ")
  .forEach((aliases, index) => aliases.split("|").forEach(alias => cursors.$set(alias, index)));

function setCursor(surface: number, cursor: string) {
  nativePost(Post.Cursor, surface, cursors.$get(cursor) ?? 0);
}

/** From `hooks.key`: the platform's menus and input methods are not to see the key. */
function keyHandled() {
  nativePost(Post.KeyHandled, 0, 0);
}

/**
 * Blocks the thread. Handles what `accepts` takes of the events for `handlers`, and what `acceptsSurface` takes of
 * those for `hooks`. The others are left for the event loop.
 */
function waitUntil(
  done: () => boolean,
  accepts: (event: NativeEvent) => boolean,
  acceptsSurface?: (surface: number) => boolean,
) {
  let at = tail;
  waits++;
  try {
    while (true) {
      hooks.render();
      if (done()) break;
      nativeWait();
      receive();
      for (; at < tail; at += queue[at + 1]) {
        const target = queue[at + 2];
        if (queue[at] === Kind.Json) {
          if (objects[target].t === "fatal") throw new Error(objects[target].message);
          if (accepts(objects[target])) dispatch(at);
        } else if (queue[at] !== Kind.Handled && acceptsSurface?.(target)) {
          dispatch(at);
        }
      }
      nativePresent();
    }
  } finally {
    waits--;
  }
  if (head < tail && !dispatching) setImmediate(onEvents);
}

/** Moves of the mouse are reported about once a frame. */
const held = new Float64Array(12);
let isHolding = false;
let lastContinuous = -Infinity;
let holdTimer: ReturnType<typeof setTimeout> | undefined;

function isContinuous(at: number): boolean {
  return queue[at] === Kind.Mouse && queue[at + 8] === 0;
}

function continuesHeld(at: number): boolean {
  return isContinuous(at) && queue[at + 2] === held[2] && queue[at + 7] === held[7] && queue[at + 10] === held[10];
}

/** Puts it in front of what has not been handled. */
function stopHolding() {
  isHolding = false;
  clearTimeout(holdTimer);
  const length = held[1];
  if (head < length) {
    reserve(length);
    queue.copyWithin(head + length, head, tail);
    tail += length;
  } else head -= length;
  for (let i = 0; i < length; i++) queue[head + i] = held[i];
  lastContinuous = -Infinity;
}

function releaseHeld() {
  if (dispatching || waits > 0) return void holdTimer!.refresh();
  stopHolding();
  onEvents();
}

/** Whether the first one in the queue has to wait. */
function defers(): boolean {
  const at = head;
  if (isHolding) {
    if (queue[at] === Kind.Scroll || queue[at] === Kind.Handled) return false;
    if (!continuesHeld(at)) {
      stopHolding();
      return defers();
    }
  } else if (!isContinuous(at)) return false;
  const now = performance.now();
  const left = lastContinuous + display.frameInterval * 0.75 - now;
  if (left <= 0) {
    lastContinuous = now;
    if (isHolding) clearTimeout(holdTimer);
    return (isHolding = false);
  }
  for (let i = 0; i < queue[at + 1]; i++) held[i] = queue[at + i];
  head += held[1];
  if (!isHolding) holdTimer = setTimeout(releaseHeld, left + display.frameInterval * 0.5).unref();
  return (isHolding = true);
}

function onEvents(insideScript?: boolean) {
  receive();
  if (dispatching || waits > 0) return;
  dispatching = true;
  try {
    // A handler that blocks in `waitUntil` adds to the queue.
    while (head < tail) {
      if (defers()) continue;
      const at = head;
      head += queue[at + 1];
      if (queue[at] === Kind.Handled) continue;
      dispatch(at);
      if (!insideScript) drainMicrotasks();
      hooks.render();
    }
    head = tail = 0;
    if (objects.length > 0) objects = [];
  } finally {
    dispatching = false;
    nativePresent();
  }
}

function isInputPending(includesContinuous: boolean) {
  if (!started) return false;
  const before = tail;
  receive();
  if (tail > before && !dispatching && waits === 0) setImmediate(onEvents);
  for (let at = head; at < tail; at += queue[at + 1]) {
    const kind = queue[at];
    if (kind === Kind.Key || kind === Kind.Text) return true;
    if (kind === Kind.Mouse ? includesContinuous || queue[at + 8] !== 0 : kind === Kind.Wheel && includesContinuous)
      return true;
  }
  return false;
}

/** Handles what has happened up to now, as far as the UI thread knows. */
function settle() {
  hooks.render();
  if (isHolding && waits === 0) stopHolding();
  onEvents(true);
}

function hold() {
  if (holds++ === 0) nativeKeepAlive(true);
}

function release() {
  if (--holds === 0) nativeKeepAlive(false);
}

function putBlob(bytes: Uint8Array): number {
  loadRenderer();
  return nativePutBlob(bytes);
}

handlers.reply = event => {
  const settle = replies.$get(event.id);
  if (settle === undefined) return;
  replies.$delete(event.id);
  release();
  settle(event);
};
handlers.text = event => hooks.text(event.s, event.text, event.key, event.range?.[0] ?? -1, event.range?.[1] ?? -1);
handlers.error = event => process.emitWarning(event.message, "DesktopWarning");
handlers.fatal = event => {
  nativeKeepAlive(false);
  throw new Error(event.message);
};

/** For the thread of a worker, which gets no events. */
const forWorker = {
  send: (command: string, argument?: unknown) => void execute(command, argument, undefined, true),
  ask: (command: string, argument?: unknown) => execute(command, argument),
  request: async (command: string, argument?: unknown) =>
    execute(command === "image.decode" ? "image.decodeSync" : command, argument),
  putBlob: nativePutBlob,
  takeBlob: nativeTakeBlob,
};

export default {
  forWorker,
  options,
  hooks,
  handlers,
  loadRenderer,
  prewarm,
  prewarmIfPackaged,
  start,
  startWith,
  isStarted: () => started,
  send,
  ask,
  request,
  requestSync,
  requestFrame,
  destroySurface,
  setCursor,
  display,
  keyHandled,
  waitUntil,
  settle,
  isInputPending,
  hold,
  release,
  putBlob,
  takeBlob: nativeTakeBlob as (id: number) => Buffer,
  findChrome,
  mapResource,
  resourcesPath,
};
