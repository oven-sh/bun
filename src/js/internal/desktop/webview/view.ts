// A page in the web engine: its pixels, and the input that goes to it.
const fs = require("node:fs");
const path = require("node:path");
const native = require("internal/desktop/native");
const { Engine } = require("internal/desktop/webview/engine");

type Size = { width: number; height: number };
/** The frames of a page that are in one process. `x` and `y` are where it was last seen. */
type Target = {
  session: string;
  frame: string;
  parent?: Target;
  children: Map<string, Target>;
  world?: Promise<number>;
  x: number;
  y: number;
  scale: number;
};
type Owner = {
  /** CSS pixels of the page to pixels of the surface. */
  toSurface(x: number, y: number): [number, number];
  surface: number;
  window(): any;
  painted(frame: any): void;
  shortcutFor(event: object): { isReserved: boolean; run(): void } | undefined;
  tooltip?(text: string): void;
};

const clipboard = () => require("internal/desktop/system").api.clipboard;
const isMac = process.platform === "darwin";
/** For so long a page that is busy holds up its input. */
const STEP_MS = 500;
const buttons = ["left", "middle", "right", "back", "forward"];
const mouseTypes = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" };
const cursors = {
  pointer: "default",
  hand: "pointer",
  nodrop: "no-drop",
  "drag-drop-none": "no-drop",
  custom: "default",
};
const modifiersOf = (m: number) => ((m & 1) << 3) | (m & 2) | ((m & 4) >> 2) | ((m & 8) >> 1);
const keyCodes = {
  __proto__: null,
  ...{ Backspace: 8, Tab: 9, Enter: 13, NumpadEnter: 13, Pause: 19, CapsLock: 20, Escape: 27, Space: 32 },
  ...{ ShiftLeft: 16, ShiftRight: 16, ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18 },
  ...{ PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 },
  ...{ PrintScreen: 44, Insert: 45, Delete: 46, MetaLeft: 91, MetaRight: isMac ? 93 : 92, ContextMenu: 93 },
  ...{ NumpadMultiply: 106, NumpadAdd: 107, NumpadSubtract: 109, NumpadDecimal: 110, NumpadDivide: 111 },
  ...{ NumLock: 144, ScrollLock: 145, Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190, Slash: 191 },
  ...{ Backquote: 192, BracketLeft: 219, Backslash: 220, BracketRight: 221, Quote: 222, IntlBackslash: 226 },
};

function keyCodeOf(key: string, code: string): number {
  if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^(?:Key|Digit).$/.test(code)) return code.charCodeAt(code.length - 1);
  if (/^F\d+$/.test(code)) return 111 + +code.slice(1);
  if (/^Numpad\d$/.test(code) && key.length === 1) return 96 + +key;
  return keyCodes[key] ?? keyCodes[code] ?? 0;
}

/** On macOS the system has the key bindings of text fields. */
function editingCommand({ key, m }: any): string | undefined {
  const [option, command] = [m & 4, m & 8];
  const deletes = { Backspace: ["Backward", "Beginning"], Delete: ["Forward", "End"] }[key];
  if (deletes) return command ? `deleteTo${deletes[1]}OfLine` : `delete${option ? "Word" : ""}${deletes[0]}`;
  const side = /^Arrow(Left|Right)$/.exec(key)?.[1];
  const end = { ArrowUp: "Beginning", ArrowDown: "End" }[key];
  let move = side && (command ? `moveTo${side}EndOfLine` : `move${option ? "Word" : ""}${side}`);
  if (end) move = command ? `moveTo${end}OfDocument` : option ? `moveTo${end}OfParagraph` : `move${key.slice(5)}`;
  if (move) return m & 1 ? move + "AndModifySelection" : move;
  if (m !== 2) return;
  return {
    a: "moveToBeginningOfParagraph",
    e: "moveToEndOfParagraph",
    k: "deleteToEndOfParagraph",
    d: "deleteForward",
  }[key];
}

/** It runs beside the scripts of the page, which do not see it. What it returns is only as honest as the page's process. */
/** The other kind of picker is a menu or a window of the engine. */
const PICKERS = `
const keepPickers = root => {
  if (!root || root.adoptedStyleSheets.includes(root.pickers)) return;
  root.pickers = new (root.ownerDocument ?? root).defaultView.CSSStyleSheet();
  root.pickers.replaceSync("select:not([multiple],[size]),::picker(select){appearance:base-select!important}");
  root.adoptedStyleSheets.push(root.pickers);
};`;

const AGENT = `${PICKERS}
globalThis.owners = new Map();
const origin = frame => {
  const rect = frame.getBoundingClientRect(), style = getComputedStyle(frame), scale = rect.width / frame.offsetWidth || 1;
  const inset = side => (frame["client" + side] + parseFloat(style["padding" + side])) * scale;
  return [rect.left + inset("Left"), rect.top + inset("Top"), scale];
};
const place = element => {
  let [x, y, scale] = [0, 0, 1];
  for (let at = element; at; at = at.ownerDocument.defaultView === window ? null : at.ownerDocument.defaultView?.frameElement) {
    const [left, top, own] = origin(at);
    [x, y, scale] = [left + x * own, top + y * own, scale * own];
  }
  return [x, y, scale];
};
const around = element => element.ownerDocument.defaultView === window ? [0, 0, 1] : place(element.ownerDocument.defaultView.frameElement);
const deepest = step => {
  for (let at = step(document); at; ) {
    const inner = at.shadowRoot ?? at.contentDocument, next = inner && step(inner);
    if (!next || next === at) return at;
    at = next;
  }
};
globalThis.hit = (x, y) => {
  for (const [id, owner] of owners) {
    const [left, top, scale] = around(owner);
    if (owner.isConnected && owner.getRootNode().elementFromPoint((x - left) / scale, (y - top) / scale) === owner) return [id, ...place(owner)];
  }
};
globalThis.focusOwner = id => {
  const owner = owners.get(id);
  if (owner && owner.getRootNode().activeElement !== owner) owner.focus({ preventScroll: true });
};
globalThis.focused = () => {
  const it = deepest(root => root.activeElement);
  for (const [id, owner] of owners) if (owner.getRootNode().activeElement === owner && (it === owner || it.contains(owner.getRootNode().host))) return { frame: [id, ...place(owner)] };
  if (!it) return {};
  if (it.matches("select")) keepPickers(it.getRootNode());
  const range = it.isContentEditable && it.getRootNode().getSelection?.().rangeCount && it.getRootNode().getSelection().getRangeAt(0);
  const rect = (range && range.getClientRects()[0]) || it.getBoundingClientRect(), [left, top, scale] = around(it);
  return {
    takesText: it.matches(":read-write:not([type=password i])"),
    hasPopup: it.matches("input:open"),
    caret: [left + rect.left * scale, top + rect.top * scale, rect.height * scale],
  };
};
globalThis.regions = () => [...document.querySelectorAll("*")].flatMap(it => {
  const { appRegion, visibility } = getComputedStyle(it);
  if (appRegion === "none" || visibility !== "visible") return [];
  return Array.from(it.getClientRects(), ({ x, y, width, height }) => [x, y, width, height, appRegion === "drag"]);
});
globalThis.selectBack = count => {
  const selection = deepest(root => root.activeElement)?.ownerDocument.getSelection();
  while (count-- > 0) selection?.modify("extend", "backward", "character");
};
globalThis.watchKey = () => deepest(root => root.activeElement)?.ownerDocument.defaultView.addEventListener("keydown", event => (globalThis.key = event), { capture: true, once: true }, (globalThis.key = null));
const elementAt = (x, y) => deepest(root => { const [left, top, scale] = around(root.documentElement ?? root.host); return root.elementFromPoint((x - left) / scale, (y - top) / scale); });
globalThis.titleAt = (x, y) => elementAt(x, y)?.closest("[title]")?.title;
globalThis.keepPickerAt = (x, y, it = elementAt(x, y)) => keepPickers(it?.closest("select")?.getRootNode());
globalThis.cursorAt = (x, y) => {
  const it = elementAt(x, y);
  if (!it) return;
  keepPickerAt(x, y, it);
  const cursor = getComputedStyle(it).cursor.split(",").at(-1).trim();
  if (cursor !== "auto") return cursor;
  if (it.matches(":read-write")) return "text";
  const [left, top, scale] = around(it), range = document.createRange();
  for (const child of it.childNodes) {
    range.selectNode(child);
    if (child.nodeType === 3 && [...range.getClientRects()].some(r => x >= left + r.left * scale && x < left + r.right * scale && y >= top + r.top * scale && y < top + r.bottom * scale)) return "text";
  }
  return "default";
};
`;

class View {
  id: number;
  image: number;
  /** Device pixels for each pixel of `size`. */
  scale: number;
  zoom = 1;
  /** Pixels of the image for each unit of the display list that has it. */
  shownAt: number;
  targetId: Promise<string>;
  created: (targetId: string) => void;
  #root: Promise<Target>;
  #release;
  #size: Size;
  #queue: (() => Promise<unknown>)[] = [];
  #isBusy = false;
  #lastIsMove = false;
  #withFocus: Target | undefined;
  #hovered: Target | undefined;
  #captured: Target | undefined;
  #hasPopup = false;
  #popupWatch: Timer | undefined;
  #regions: Timer | undefined;
  #pressed: any;
  #drag: object | undefined;
  #composition = "";
  #caret: object | undefined;
  #tooltip: Timer | undefined;
  #isVisible = true;
  #isResting = false;
  #rest: Timer | undefined;
  mayRest = true;
  frameRate = 60;
  #hasMouse = false;
  #cursor = "default";
  #hasAccessibility = false;
  #accessibility: Timer | undefined;

  constructor(
    readonly engine: any,
    readonly owner: Owner,
    size: Size,
    scale: number,
    readonly isFrame: boolean,
  ) {
    this.id = engine.newId();
    this.#size = size;
    this.scale = this.shownAt = scale;
    this.#release = engine.hold();
    if (engine.paintsToFiles) fs.writeFileSync(this.#file(), "", { mode: 0o600 });
    this.image = native.ask("webview.open", { path: this.#file() });
    ({ promise: this.targetId, resolve: this.created } = Promise.withResolvers<string>());
    this.#root = this.targetId.then(async targetId => {
      const { sessionId } = await engine.inspect("Target.attachToTarget", { targetId, flatten: true });
      return this.#adopt(sessionId, targetId);
    });
    this.#root.catch(() => {});
  }

  #file() {
    return this.engine.paintsToFiles ? path.join(this.engine.directory, `frame${this.id}`) : undefined;
  }

  /** For the `create` command. */
  describe(session: number, preferences: object) {
    const { id, scale, isFrame } = this;
    return { id, scale, isFrame, session, preferences, ...this.#size, file: this.#file(), frameRate: this.frameRate };
  }

  #adopt(session: string, frame: string, parent?: Target): Target {
    const target: Target = { session, frame, parent, children: new Map(), x: 0, y: 0, scale: 1 };
    parent?.children.$set(frame, target);
    if (parent) parent.world = undefined;
    this.engine.inspected.set(session, (method: string, params: any) => {
      if (method === "Target.attachedToTarget") this.#adopt(params.sessionId, params.targetInfo.targetId, target);
      else if (method === "Target.detachedFromTarget") this.#forget(target.children.$get(params.targetId));
      else if (method === "Input.dragIntercepted") this.#startDrag(params.data);
      else if (method === "Page.fileChooserOpened") this.#chooseFiles(target, params);
    });
    const only = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: "iframe" }] };
    this.#tell(target, "Target.setAutoAttach", only);
    this.#tell(target, "Input.setInterceptDrags", { enabled: true });
    this.#tell(target, "Page.enable");
    const pickers = { source: `{${PICKERS}keepPickers(document)}`, worldName: "bun:desktop", runImmediately: true };
    this.#tell(target, "Page.addScriptToEvaluateOnNewDocument", pickers);
    this.#tell(target, "Page.setInterceptFileChooserDialog", { enabled: true });
    return target;
  }

  async #chooseFiles(target: Target, { mode, backendNodeId }: any) {
    const properties = mode === "selectMultiple" ? ["openFile", "multiSelections"] : ["openFile"];
    const { filePaths } = await require("internal/desktop/dialog").showOpenDialog(this.owner.window(), { properties });
    this.#tell(target, "DOM.setFileInputFiles", { files: filePaths, backendNodeId });
  }

  #forget(target: Target | undefined) {
    if (!target) return;
    target.children.$forEach(child => this.#forget(child));
    target.parent?.children.$delete(target.frame);
    this.engine.inspected.delete(target.session);
    if (this.#withFocus === target) this.#withFocus = undefined;
    if (this.#hovered === target) this.#hovered = undefined;
    if (this.#captured === target) this.#captured = undefined;
  }

  #tell(target: Target, method: string, params?: object): Promise<any> {
    return this.engine.inspect(method, params, target.session).catch(() => {});
  }

  async #createWorld({ session, frame: frameId, children }: Target) {
    const inspect = (method: string, params: object) => this.engine.inspect(method, params, session);
    const world = { frameId, worldName: "bun:desktop", grantUniveralAccess: true };
    const { executionContextId } = await inspect("Page.createIsolatedWorld", world);
    await inspect("Runtime.evaluate", { expression: `{${AGENT}}`, contextId: executionContextId, silent: true });
    const register = async (id: string) => {
      const { backendNodeId } = await inspect("DOM.getFrameOwner", { frameId: id });
      const { objectId } = (await inspect("DOM.resolveNode", { backendNodeId, executionContextId })).object;
      const functionDeclaration = "function(id){owners.set(id,this)}";
      await inspect("Runtime.callFunctionOn", { objectId, functionDeclaration, arguments: [{ value: id }] });
      await inspect("Runtime.releaseObject", { objectId });
    };
    await Promise.allSettled(Array.from(children.keys(), register));
    return executionContextId;
  }

  async #evaluate(target: Target, expression: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const contextId = await (target.world ??= this.#createWorld(target));
        const params = { expression, contextId, returnByValue: true, silent: true, timeout: 500 };
        return (await this.engine.inspect("Runtime.evaluate", params, target.session)).result.value;
      } catch {
        target.world = undefined;
      }
    }
  }

  #descend(from: Target, [id, x, y, scale]: any[]) {
    const child = from.children.$get(id);
    const place = { x: from.x + x * from.scale, y: from.y + y * from.scale, scale: from.scale * scale };
    return child && Object.assign(child, place);
  }

  /** Electron does not find the frame under the mouse in a page that is offscreen. */
  #targetAt(x: number, y: number) {
    return this.engine.type === "electron" ? this.#frameAt(x, y) : this.#root;
  }

  async #frameAt(x: number, y: number) {
    let at = await this.#root;
    while (at.children.size > 0) {
      const found = await this.#evaluate(at, `hit(${(x - at.x) / at.scale},${(y - at.y) / at.scale})`);
      const child = $isArray(found) && this.#descend(at, found);
      if (!child) break;
      at = child;
    }
    return at;
  }

  async #focused(): Promise<[Target, any]> {
    for (let at = await this.#root; ;) {
      const found = (await this.#evaluate(at, "focused()")) ?? {};
      const child = $isArray(found.frame) && this.#descend(at, found.frame);
      if (!child) return [at, found];
      at = child;
    }
  }

  /** A frame that gets a click while the page is being activated is not always made the focused one. */
  async #focusAround(target: Target) {
    for (let at = target; at.parent; at = at.parent)
      await this.#evaluate(at.parent, `focusOwner(${JSON.stringify(at.frame)})`);
  }

  async #inspectFocus() {
    const [target, { takesText, hasPopup, caret }] = await this.#focused();
    this.#withFocus = target;
    const hadPopup = this.#hasPopup;
    this.#hasPopup = !!hasPopup && this.engine.type === "electron";
    // Nothing tells that it has closed, and it stays painted.
    clearTimeout(this.#popupWatch);
    if (this.#hasPopup) this.#popupWatch = setTimeout(() => this.#enqueue(() => this.#inspectFocus()), 100).unref();
    else if (hadPopup) this.engine.tell("view", this.id, "invalidate");
    this.#caret = undefined;
    if (takesText) {
      const [left, top, height] = Array.from(caret, value => (+(value as number) || 0) * target.scale);
      const [x, y] = this.owner.toSurface(target.x + left, target.y + top);
      this.#caret = { x, y, width: 1, height: height * this.zoom };
    }
    this.#updateInputMethod();
    this.accessibilityChanged();
  }

  #updateInputMethod(selection = [0, 0]) {
    const text = this.#composition;
    const state = {
      enabled: !!this.#caret,
      text,
      selection,
      composing: text ? [0, text.length] : null,
      rect: this.#caret,
    };
    native.send("surface.ime", { id: this.owner.surface, ...state });
  }

  /** In order. Of the movements that wait, the last one is enough. */
  #enqueue(step: () => Promise<unknown>, isMove = false) {
    if (isMove && this.#lastIsMove) this.#queue.pop();
    this.#lastIsMove = isMove;
    this.#queue.push(step);
    if (!this.#isBusy) this.#drain();
  }

  whenIdle() {
    return new Promise<void>(resolve => this.#enqueue(async () => resolve()));
  }

  async #drain() {
    this.#isBusy = true;
    for (let step; (step = this.#queue.shift());) {
      if (this.#queue.length === 0) this.#lastIsMove = false;
      await Promise.race([step().catch(() => {}), Bun.sleep(STEP_MS)]);
    }
    this.#isBusy = false;
  }

  /** A page that shows a dialog, or that hangs, does not acknowledge its input. */
  #dispatch(target: Target, method: string, params: object) {
    return Promise.race([this.#tell(target, method, params), Bun.sleep(100)]);
  }

  async #toPopup(type: string, { x, y, b, n, dx, dy }: any): Promise<boolean> {
    const event = {
      type,
      x: x * this.zoom,
      y: y * this.zoom,
      button: buttons[b],
      clickCount: n,
      deltaX: -dx,
      deltaY: -dy,
    };
    return this.#hasPopup && this.engine.request("popupInput", this.id, event);
  }

  async #mouse(event: any) {
    const { e: kind, x, y, b, n, m } = event;
    const leave = (target?: Target) =>
      target && this.#tell(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: -1, y: -1 });
    if (kind === "leave") return leave(this.#hovered);
    if (await this.#toPopup({ move: "mouseMove", down: "mouseDown", up: "mouseUp" }[kind], event)) {
      return kind === "up" && this.#inspectFocus();
    }
    const target = (!this.#drag && this.#captured) || (await this.#targetAt(x, y));
    const local = { x: (x - target.x) / target.scale, y: (y - target.y) / target.scale, modifiers: modifiersOf(m) };
    if (this.#drag) return this.#continueDrag(target, kind === "up" ? "drop" : "dragOver", local);
    if (target !== this.#hovered) leave(this.#hovered);
    this.#hovered = target;
    this.#captured = event.buttons ? target : undefined;
    const held = event.buttons & 1 ? "left" : event.buttons & 2 ? "right" : event.buttons & 4 ? "middle" : "none";
    const button = kind === "move" ? held : buttons[b];
    const params = {
      type: mouseTypes[kind],
      ...local,
      button,
      buttons: event.buttons,
      clickCount: kind === "move" ? 0 : n,
    };
    await this.#dispatch(target, "Input.dispatchMouseEvent", params);
    if (kind === "down") await this.#focusAround(target);
    if (kind === "up") this.#takeClipboard();
    if (kind !== "move") return this.#inspectFocus();
    if (event.buttons) return;
    const ask = async (name: string) => {
      const at = await this.#frameAt(x, y);
      return this.#evaluate(at, `${name}(${(x - at.x) / at.scale},${(y - at.y) / at.scale})`);
    };
    if (this.engine.type === "chromium") this.showCursor(String((await ask("cursorAt")) ?? "default"));
    else await ask("keepPickerAt");
    if (!this.owner.tooltip) return;
    this.#tooltip = setTimeout(async () => {
      const title = await ask("titleAt");
      if (title && this.#tooltip) this.owner.tooltip!(String(title).slice(0, 1024));
    }, 500);
  }

  async #wheel(event: any) {
    if (await this.#toPopup("mouseWheel", event)) return;
    const { x, y, m } = event;
    const isPinch = event.t === "pinch";
    const target = await this.#targetAt(x, y);
    const delta = isPinch ? [0, -100 * event.delta] : m & 1 && !event.dx ? [event.dy, 0] : [event.dx, event.dy];
    this.#tell(target, "Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: (x - target.x) / target.scale,
      y: (y - target.y) / target.scale,
      deltaX: delta[0] / this.zoom,
      deltaY: delta[1] / this.zoom,
      modifiers: modifiersOf(isPinch ? m | 2 : m),
    });
  }

  #startDrag(data: object) {
    this.#drag = data;
    this.#captured = this.#hovered = undefined;
  }

  async #continueDrag(target: Target, type: string, local: object) {
    const send = (to: Target, type: string, at = local) =>
      this.#dispatch(to, "Input.dispatchDragEvent", { type, ...at, data: this.#drag });
    if (target !== this.#hovered) {
      if (this.#hovered) await send(this.#hovered, "dragOver", { x: -1, y: -1 });
      await send((this.#hovered = target), "dragEnter");
    }
    await send(target, type);
    if (type === "dragOver") return;
    this.#drag = undefined;
    await this.#dispatch(target, "Input.dispatchMouseEvent", { type: "mouseReleased", ...local, button: "left" });
  }

  async #fileDrag({ e: kind, x, y, paths, m }: any) {
    const target = kind === "leave" ? this.#hovered : await this.#targetAt(x, y);
    if (!target) return;
    if (!this.#drag) this.#startDrag({ items: [], files: paths, dragOperationsMask: 1 });
    const local = { x: (x - target.x) / target.scale, y: (y - target.y) / target.scale, modifiers: modifiersOf(m) };
    await this.#continueDrag(target, { drop: "drop", leave: "dragCancel" }[kind] ?? "dragOver", local);
  }

  #describeKey({ key, code, location, repeat, m }: any) {
    const windowsVirtualKeyCode = key === "Process" || key === "Dead" ? 229 : keyCodeOf(key, code);
    const where = { location: location === 3 ? 0 : location, isKeypad: location === 3 };
    return { key, code, windowsVirtualKeyCode, ...where, autoRepeat: !!repeat, modifiers: modifiersOf(m) };
  }

  /** What has to be decided before the system goes on with the key. */
  #keyDown(event: any) {
    const { key, m } = event;
    if (event.composing || key === "Process" || key === "Dead") return;
    const edits = !isMac && m & 2 && !(m & 12) && /^[acvxyz]$/i.test(key);
    const shortcut = edits ? undefined : this.owner.shortcutFor(event);
    if (shortcut?.isReserved) return void shortcut.run();
    const isCommand = key.length > 2 ? !(m & (isMac ? 0 : 4)) && !/^F\d/.test(key) : isMac && (m & 14) === 2;
    if (shortcut || isCommand) native.keyHandled();
    return shortcut;
  }

  /** Until the browser has learned which frame a click has focused, it gives keys to the wrong one. */
  #keyTarget() {
    return (this.engine.type === "electron" && this.#withFocus) || this.#root;
  }

  async #key(event: any, shortcut?: { run(): void }) {
    const root = await this.#keyTarget();
    const send = (type: string, more?: object) =>
      this.#dispatch(root, "Input.dispatchKeyEvent", { type, ...this.#describeKey(event), ...more });
    if (event.e === "up") {
      if (event.m & 10) this.#takeClipboard();
      return send("keyUp").then(() => this.#inspectFocus());
    }
    if ((event.m & 10 && /^v$/i.test(event.key)) || (event.m & 1 && event.key === "Insert"))
      await this.#giveClipboard();
    if (this.#drag)
      return event.key === "Escape" && this.#continueDrag(this.#hovered ?? root, "dragCancel", { x: 0, y: 0 });
    const watched = shortcut && (await this.#focused())[0];
    if (watched) await this.#evaluate(watched, "watchKey()");
    const command = isMac && editingCommand(event);
    await send("rawKeyDown", command ? { commands: [command] } : undefined);
    if (event.key === "Enter") await send("char", { text: "\r" });
    if (watched && (await this.#evaluate(watched, "key?.defaultPrevented")) !== true) shortcut.run();
  }

  edit(name: string) {
    this.#enqueue(async () => {
      if (name.startsWith("paste")) await this.#giveClipboard();
      this.engine.tell("view", this.id, name);
      if (name === "copy" || name === "cut") this.#takeClipboard();
    });
  }

  async #giveClipboard() {
    if (!this.engine.hasOwnClipboard) return;
    await this.engine.perform("module", "clipboard", "writeText", [(this.engine.copied = clipboard().readText())]);
  }

  /** What a page copies because of the input it got. */
  #takeClipboard() {
    if (!this.engine.hasOwnClipboard) return;
    setTimeout(async () => {
      const text = await this.engine.perform("module", "clipboard", "readText").catch(() => {});
      if (text && text !== this.engine.copied) clipboard().writeText((this.engine.copied = text));
    }, 100);
  }

  /** The input method replaces what has just been typed. */
  async #selectReplaced(range?: number[]) {
    if (range) await this.#evaluate((await this.#focused())[0], `selectBack(${range[1] - range[0]})`);
  }

  async #text({ text, key, range }: any, pressed: any) {
    const root = await this.#keyTarget();
    await this.#selectReplaced(range);
    const isTyped = key && pressed && !this.#composition;
    this.#composition = "";
    if (isTyped)
      return this.#dispatch(root, "Input.dispatchKeyEvent", { type: "char", ...this.#describeKey(pressed), text });
    await this.#dispatch(root, "Input.insertText", { text });
    return this.#inspectFocus();
  }

  async #compose(text: string, [selectionStart, selectionEnd]: number[]) {
    if (text === "" && this.#composition === "") return;
    this.#composition = text;
    this.#updateInputMethod([selectionStart, selectionEnd]);
    await this.#dispatch(await this.#keyTarget(), "Input.imeSetComposition", { text, selectionStart, selectionEnd });
  }

  /** An event of a surface, with CSS pixels of the page for `x` and `y`. */
  input(event: any) {
    if (this.#tooltip) {
      clearTimeout(this.#tooltip);
      this.#tooltip = undefined;
      this.owner.tooltip!("");
    }
    switch (event.t) {
      case "mouse":
        if (this.#hasMouse === (event.e === "leave")) {
          this.#hasMouse = !this.#hasMouse;
          this.showCursor(this.#cursor);
        }
        return this.#enqueue(() => this.#mouse(event), event.e === "move");
      case "wheel":
      case "pinch":
        return this.#enqueue(() => this.#wheel(event));
      case "drag":
        return this.#enqueue(() => this.#fileDrag(event), event.e === "over");
      case "key":
        this.#pressed = event;
        const shortcut = event.e === "down" ? this.#keyDown(event) : undefined;
        return this.#enqueue(() => this.#key(event, shortcut));
      case "text":
        const pressed = this.#pressed;
        return this.#enqueue(() => this.#text(event, pressed));
      case "compose":
        return this.#enqueue(() =>
          this.#selectReplaced(event.range).then(() => this.#compose(event.text, event.selection)),
        );
      case "composeEnd":
        return this.#enqueue(() => this.#compose("", [0, 0]));
      case "focus":
        this.engine.tell("window", this.id, "focusOnWebView");
        return this.#enqueue(() => this.#setActive(true).then(() => this.#inspectFocus()));
      case "blur":
        this.#caret = undefined;
        this.#updateInputMethod();
        this.engine.tell("window", this.id, "blurWebView");
        return this.#enqueue(() => this.#setActive(false));
      case "a11y":
        this.#hasAccessibility = event.active;
        return this.accessibilityChanged();
      case "a11yAction":
        return this.#enqueue(() => this.#perform(event));
    }
  }

  /** Its window is never the key window. */
  async #setActive(enabled: boolean) {
    await this.#tell(await this.#root, "Emulation.setFocusEmulationEnabled", { enabled });
  }

  accessibilityChanged() {
    if (!this.#hasAccessibility || this.#accessibility || this.isFrame) return;
    this.#accessibility = setTimeout(async () => {
      const root = await this.#root;
      const [tree, snapshot] = await Promise.all([
        this.#tell(root, "Accessibility.getFullAXTree"),
        this.#tell(root, "DOMSnapshot.captureSnapshot", { computedStyles: [] }),
      ]);
      this.#accessibility = undefined;
      if (!tree || !snapshot) return;
      const converted = require("internal/desktop/webview/a11y").convert(tree.nodes, snapshot.documents[0], this.scale);
      native.send("surface.a11y", { id: this.owner.surface, ...converted });
    }, 300);
  }

  async #perform({ node: backendNodeId, action, data }: any) {
    const root = await this.#root;
    if (action === "scrollIntoView") return this.#tell(root, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
    await this.#tell(root, "DOM.focus", { backendNodeId });
    if (action === "focus") return;
    const { objectId } = (await this.#tell(root, "DOM.resolveNode", { backendNodeId })).object;
    const functionDeclaration = `function(action, data) {
      if (action === "setValue") this.value = data;
      else if (action === "increment") this.stepUp();
      else if (action === "decrement") this.stepDown();
      else return this.click();
      for (const type of ["input", "change"]) this.dispatchEvent(new Event(type, { bubbles: true }));
    }`;
    const args = [{ value: action }, { value: data }];
    await this.#tell(root, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: args,
      userGesture: true,
    });
    this.accessibilityChanged();
  }

  resize(width: number, height: number) {
    const size = { width: Math.max(Math.ceil(width), 1), height: Math.max(Math.ceil(height), 1) };
    if (size.width === this.#size.width && size.height === this.#size.height) return;
    this.#size = size;
    this.engine.tell("window", this.id, "setContentSize", [size.width, size.height]);
  }

  setVisible(isVisible: boolean) {
    if (isVisible === this.#isVisible) return;
    this.#isVisible = isVisible;
    this.engine.tell("view", this.id, isVisible ? "startPainting" : "stopPainting");
    if (isVisible) this.engine.tell("view", this.id, "invalidate");
    this.wake();
  }

  /** The engine takes every view for visible, so a hidden one is slowed down while nothing is asked of it. */
  wake() {
    clearTimeout(this.#rest);
    if (this.#isResting) this.engine.tell("view", this.id, "setFrameRate", [this.frameRate]);
    this.#isResting = false;
    if (this.#isVisible || !this.mayRest) return;
    this.#rest = setTimeout(() => {
      this.#isResting = true;
      this.engine.tell("view", this.id, "setFrameRate", [1]);
    }, 1000).unref();
  }

  paint(frame: object) {
    native.send("webview.frame", { id: this.image, scale: this.shownAt, ...frame });
    this.owner.painted(frame);
    if (this.owner.mayDragWindow?.()) this.#regions ??= setTimeout(() => this.#updateRegions(), 500).unref();
  }

  async #updateRegions() {
    const found = await this.#evaluate(await this.#root, "regions()");
    this.#regions = undefined;
    const rect = (it: unknown[]) => [0, 1, 2, 3].map(index => (+(it[index] as number) || 0) * this.zoom);
    const regions = Array.from(found ?? [], (it: any) => [rect(it), !!it[4]]);
    native.send("webview.regions", { id: this.image, surface: this.owner.surface, regions });
  }

  showCursor(cursor: string) {
    this.#cursor = cursor;
    if (this.#hasMouse) native.setCursor(this.owner.surface, cursor);
  }

  destroy() {
    clearTimeout(this.#tooltip);
    clearTimeout(this.#accessibility);
    clearTimeout(this.#rest);
    clearTimeout(this.#popupWatch);
    clearTimeout(this.#regions);
    this.#queue.length = 0;
    this.#root.then(
      root => this.#forget(root),
      () => {},
    );
    this.engine.views.delete(this.id);
    this.engine.send("destroy", this.id);
    native.send("webview.close", { id: this.image });
    this.#release();
  }
}

Object.assign(Engine.handlers, {
  created: (engine: any, id: number, targetId: string) => engine.views.get(id)?.view.created(targetId),
  cursor: (engine: any, id: number, type: string) => engine.views.get(id)?.view.showCursor(cursors[type] ?? type),
  paint(engine: any, id: number, frame: object) {
    const view = engine.views.get(id)?.view;
    if (view) view.paint(frame);
    else native.send("webview.frame", { id: 0, ...frame });
    engine.send("painted", id);
  },
});

export default { View };
