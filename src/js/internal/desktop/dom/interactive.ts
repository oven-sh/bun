// The top layer and what is in it, and `details`.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const focusing = require("internal/desktop/dom/focus");
const { boundingRect, define } = require("internal/desktop/dom/html");
const { Element, matches, referenced } = require("internal/desktop/dom/node");

const { HTML, asciiLower, domError, flags, getAttr, hasAttr, hooks, isHtml, rare, setState, states } = core;
const { wrap, wrapOrNull } = core;
const { CONNECTED } = flags;

type N = $Dom.N;
type Doc = $Dom.Doc;
type Page = $Dom.Page;

function setInTopLayer(node: N, on: boolean, doc = node.doc) {
  doc.topLayer = doc.topLayer.filter(it => it !== node);
  if (on) doc.topLayer.push(node);
  doc.page?.topLayerChanged();
}

/** What is not in it is inert. */
function topModal(doc: Doc): N | null {
  if (doc.topLayer.length === 0) return null;
  return doc.topLayer.findLast(node => node.state & states.MODAL) ?? fullscreenElement(doc);
}

function beforeToggle(node: N, open: boolean, source: N | null): boolean {
  const [oldState, newState] = open ? ["closed", "open"] : ["open", "closed"];
  const init = { oldState, newState, cancelable: open, source: wrapOrNull(source) };
  return events.dispatch(node, new events.ToggleEvent("beforetoggle", init));
}

const pendingToggles = new WeakMap<N, { oldState: string }>();
const pendingPopoverToggles = new WeakMap<N, { oldState: string }>();

function queueTask(node: N, task: () => void) {
  (node.doc.page ?? core.realm.page).queueTask(task);
}

function queueToggle(node: N, open: boolean, source: N | null = null, trackers = pendingToggles) {
  const pending = { oldState: trackers.get(node)?.oldState ?? (open ? "closed" : "open") };
  trackers.set(node, pending);
  queueTask(node, () => {
    if (trackers.get(node) !== pending) return;
    trackers.delete(node);
    const init = { ...pending, newState: open ? "open" : "closed", source: wrapOrNull(source) };
    events.dispatch(node, new events.ToggleEvent("toggle", init));
  });
}

// ───────────────────────────── close watchers ─────────────────────────────

/** https://html.spec.whatwg.org/#close-watcher */
class Watcher {
  page: Page;
  cancelAction: (isCancelable: boolean) => boolean;
  closeAction: () => void;
  isEnabled: () => boolean;
  isCanceling = false;

  constructor(page: Page, cancel: Watcher["cancelAction"], close: () => void, isEnabled = () => true) {
    this.page = page;
    this.cancelAction = cancel;
    this.closeAction = close;
    this.isEnabled = isEnabled;
    const groups = page.closeWatchers;
    if (groups.length < page.allowedWatcherGroups) groups.push([this]);
    else groups[groups.length - 1].push(this);
    page.activationAllowsWatcherGroup = true;
  }

  isActive() {
    return this.page.closeWatchers.some(group => group.includes(this));
  }

  /** False if it was prevented. */
  requestClose(needsActivation: boolean): boolean {
    const { page } = this;
    if (!this.isActive() || !this.isEnabled() || this.isCanceling || page.isDisposed) return true;
    const mayPrevent = page.closeWatchers.length < page.allowedWatcherGroups && page.hasHistoryActionActivation;
    this.isCanceling = true;
    const continues = this.cancelAction(!needsActivation || mayPrevent);
    this.isCanceling = false;
    if (continues) this.close();
    else for (const it of page.tree()) it.hasHistoryActionActivation = false;
    return continues;
  }

  close() {
    if (!this.isActive() || !this.isEnabled() || this.page.isDisposed) return;
    this.destroy();
    this.closeAction();
  }

  destroy() {
    const { page } = this;
    page.closeWatchers = page.closeWatchers
      .map(group => group.filter(it => it !== this))
      .filter(group => group.length > 0);
  }
}

/** For Escape. */
function closeTopmost(page: Page): boolean {
  let isHandled = false;
  for (const watcher of page.closeWatchers.at(-1)?.toReversed() ?? []) {
    if (watcher.isEnabled()) isHandled = true;
    if (!watcher.requestClose(true)) break;
  }
  if (page.allowedWatcherGroups > 1) page.allowedWatcherGroups--;
  return isHandled;
}

class CloseWatcher extends events.EventTarget {
  #watcher: Watcher;

  constructor(options: any = {}) {
    super();
    const { page } = core.realm;
    const signal = options?.signal;
    if (signal !== undefined && !$isAbortSignal(signal)) throw new TypeError("The signal is not an 'AbortSignal'.");
    if (page.isDisposed) throw domError("InvalidStateError", "The document is not fully active.");
    this.#watcher = new Watcher(
      page,
      isCancelable => events.fire(this.$impl, "cancel", false, isCancelable),
      () => events.fire(this.$impl, "close"),
    );
    if (signal?.aborted) this.#watcher.destroy();
    else if (signal) $addAbortAlgorithmToSignal(signal, () => this.#watcher.destroy());
  }
  requestClose() {
    this.#watcher.requestClose(false);
  }
  close() {
    this.#watcher.close();
  }
  destroy() {
    this.#watcher.destroy();
  }
}
events.defineHandlers(CloseWatcher.prototype, ["cancel", "close"]);
core.expose(CloseWatcher);

// ───────────────────────────── popovers ─────────────────────────────

declare global {
  namespace $Dom {
    type Popover = {
      type: string;
      mode: string;
      invoker: N | null;
      previousFocus: N | null;
      isHiding: boolean;
      watcher: any;
    };
  }
}

function popoverState(node: N): string | null {
  const value = node.rare?.pseudo === "picker(select)" ? "auto" : getAttr(node, "popover");
  if (value === null || node.ns !== HTML) return null;
  const lower = asciiLower(value);
  return lower === "" || lower === "auto" ? "auto" : lower === "hint" ? "hint" : "manual";
}

const isShowing = (node: N) => (node.state & states.POPOVER_OPEN) !== 0;

function canToggle(node: N, expectedShowing: boolean, throws: boolean, doc = node.doc, ignoresTree = false): boolean {
  let error: [string, string] | undefined;
  if (!ignoresTree && popoverState(node) === null)
    error = ["NotSupportedError", "The element does not have a popover attribute."];
  else if (isShowing(node) !== expectedShowing) return false;
  else if (!ignoresTree && (!(node.flags & CONNECTED) || node.doc.page === null || node.doc !== doc)) {
    error = ["InvalidStateError", "Invalid on disconnected popover elements."];
  } else if (node.state & (states.MODAL | states.FULLSCREEN))
    error = ["InvalidStateError", "It is already in the top layer."];
  if (error !== undefined && throws) throw domError(...error);
  return error === undefined;
}

/** From the bottom to the top. */
function stack(doc: Doc, mode: string): N[] {
  return doc.topLayer.filter(node => node.rare?.popover?.mode === mode);
}

function popoverAround(node: N | null): N | null {
  for (; node !== null; node = core.flatParent(node)) {
    if (isShowing(node) && node.rare!.popover!.mode !== "manual") return node;
  }
  return null;
}

function higher(doc: Doc, a: N | null, b: N | null): N | null {
  const all = [...stack(doc, "auto"), ...stack(doc, "hint")];
  return all.indexOf(a!) > all.indexOf(b!) ? a : b;
}

function hideStackUntil(doc: Doc, kept: N | null, mode: string, restoresFocus: boolean, fires: boolean) {
  const list = stack(doc, mode);
  const remaining = list.slice(0, list.indexOf(kept!) + 1);
  for (const node of list.slice(remaining.length).reverse()) hidePopover(node, false, restoresFocus, null, fires);
  for (const node of stack(doc, mode).reverse())
    if (!remaining.includes(node)) hidePopover(node, false, restoresFocus, null, false);
}

function hideAbove(doc: Doc, kept: N | null, restoresFocus: boolean) {
  const isHint = kept?.rare?.popover?.mode === "hint";
  hideStackUntil(doc, kept, "hint", restoresFocus, true);
  hideStackUntil(doc, isHint ? doc.hintParent : kept, "auto", restoresFocus, true);
}

function showPopover(node: N, throws: boolean, invoker: N | null) {
  const { doc } = node;
  if (!canToggle(node, false, throws)) return;
  if (doc.popoverChanges > 0) {
    if (throws) throw domError("InvalidStateError", "Another popover is being shown or hidden.");
    return;
  }
  doc.popoverChanges = (doc.popoverChanges + 1) | 0;
  try {
    show(node, doc, throws, invoker);
  } finally {
    doc.popoverChanges = (doc.popoverChanges - 1) | 0;
  }
}

function show(node: N, doc: Doc, throws: boolean, invoker: N | null) {
  const type = popoverState(node)!;
  const isStillValid = () => {
    if (!canToggle(node, false, throws, doc)) return false;
    if (popoverState(node) === type) return true;
    if (throws) throw domError("InvalidStateError", "The popover attribute has changed.");
    return false;
  };
  if (!beforeToggle(node, true, invoker) || !isStillValid()) return;
  let mode = type;
  let watcher: Watcher | null = null;
  let restoresFocus = false;
  if (type !== "manual") {
    const ancestor = higher(doc, popoverAround(core.flatParent(node)), popoverAround(invoker));
    if (ancestor?.rare!.popover!.mode === "hint") mode = "hint";
    hideStackUntil(doc, ancestor, "hint", false, true);
    if (mode === "auto") hideStackUntil(doc, ancestor, "auto", false, true);
    if (!isStillValid()) return;
    restoresFocus = stack(doc, "auto").length + stack(doc, "hint").length === 0;
    if (mode === "hint" && ancestor?.rare!.popover?.mode === "auto") doc.hintParent ??= ancestor;
    watcher = new Watcher(
      doc.page!,
      () => true,
      () => hidePopover(node, false),
    );
  }
  const previousFocus = restoresFocus ? doc.focused : null;
  rare(node).popover = { type, mode, invoker, previousFocus, isHiding: false, watcher };
  setState(node, states.POPOVER_OPEN, true);
  setInTopLayer(node, true);
  if (invoker !== null) doc.engine.setImplicitAnchor?.(node.id, invoker.id);
  core.sync(doc).updateStyle();
  if (isHtml(node, "dialog")) focusDialog(node);
  else {
    const control = hasAttr(node, "autofocus") ? node : focusing.autofocusDelegate(node);
    if (control !== null) focusControl(control);
  }
  queueToggle(node, true, invoker, pendingPopoverToggles);
}

function hidePopover(
  node: N,
  throws: boolean,
  restoresFocus = true,
  source: N | null = null,
  fires = true,
  ignoresTree = false,
) {
  const { doc } = node;
  if (!canToggle(node, true, throws, doc, ignoresTree)) return;
  const popover = node.rare!.popover!;
  const isNested = popover.isHiding;
  popover.isHiding = true;
  doc.popoverChanges = (doc.popoverChanges + 1) | 0;
  try {
    if (popover.mode !== "manual") {
      if (popover.mode === "hint" || node === doc.hintParent)
        hideStackUntil(doc, node, "hint", restoresFocus, fires && !isNested);
      if (popover.mode === "auto") hideStackUntil(doc, node, "auto", restoresFocus, fires && !isNested);
      if (!canToggle(node, true, throws, doc, ignoresTree)) return;
    }
    if (fires && !isNested) {
      beforeToggle(node, false, source);
      if (!canToggle(node, true, throws, doc, ignoresTree)) return;
    }
    const hadFocus = core.containsFlat(node, doc.focused);
    node.rare!.popover = null;
    setState(node, states.POPOVER_OPEN, false);
    if (node.flags & flags.USER_AGENT) setState(node.rare!.originator!, states.PICKER_OPEN, false);
    setInTopLayer(node, false, doc);
    if (node === doc.hintParent || stack(doc, "hint").length === 0) doc.hintParent = null;
    if (fires && !isNested) queueToggle(node, false, source, pendingPopoverToggles);
    const { previousFocus } = popover;
    if (restoresFocus && hadFocus && previousFocus !== null) {
      focusing.focus(previousFocus, focusing.SCRIPT, { preventScroll: true });
    }
  } finally {
    if (!isNested) popover.isHiding = false;
    popover.watcher?.destroy();
    doc.popoverChanges = (doc.popoverChanges - 1) | 0;
  }
}

function togglePopover(node: N, force: boolean | undefined, source: N | null): boolean {
  if (isShowing(node) && force !== true) hidePopover(node, true);
  else if (!isShowing(node) && force !== false) showPopover(node, true, source);
  else canToggle(node, isShowing(node), true);
  return isShowing(node);
}

function popoverTarget(node: N): N | null {
  if (!hooks.invokesPopovers(node)) return null;
  const commanded = isHtml(node, "button") ? referenced(node, "commandfor")?.[0] : undefined;
  if (commanded !== undefined && !commandOf(node).endsWith("-popover")) return null;
  const target = commanded ?? referenced(node, "popovertarget")?.[0];
  return target !== undefined && popoverState(target) !== null ? target : null;
}

function clickedPopover(target: N): N | null {
  let invoked: N | null = null;
  for (let at: N | null = target; at !== null && invoked === null; at = core.flatParent(at)) {
    const popover = hooks.pickerOf(at) ?? popoverTarget(at);
    if (popover !== null && isShowing(popover) && popover.rare!.popover!.mode !== "manual") invoked = popover;
  }
  return higher(target.doc, popoverAround(target), invoked);
}

function clickedDialog(target: N, x: number, y: number): N | null {
  for (let at: N | null = target; at !== null; at = core.flatParent(at)) {
    if (!isHtml(at, "dialog") || !hasAttr(at, "open")) continue;
    const [left, top, width, height] = boundingRect(at);
    if (at !== target || (x >= left && x < left + width && y >= top && y < top + height)) return at;
  }
  return null;
}

/** For the press and for the release of the primary button. */
function lightDismiss(page: Page, target: N, isDown: boolean, x: number, y: number) {
  const { doc } = page;
  if (doc.topLayer.length === 0 && doc.openDialogs.length === 0) return;
  const popover = clickedPopover(target);
  const dialog = clickedDialog(target, x, y);
  if (isDown) return void (page.pressedLayers = [popover, dialog]);
  const [pressedPopover, pressedDialog] = page.pressedLayers ?? [];
  page.pressedLayers = null;
  if (popover === pressedPopover) hideAbove(doc, popover, false);
  const last = doc.openDialogs.at(-1);
  if (last && dialog === pressedDialog && dialog !== last && closedBy(last) === "any")
    last.x.watcher?.requestClose(false);
}

// ───────────────────────────── dialogs ─────────────────────────────

function closedBy(node: N): string {
  const value = asciiLower(getAttr(node, "closedby") ?? "");
  if (value === "any" || value === "closerequest" || value === "none") return value;
  return node.state & states.MODAL ? "closerequest" : "none";
}

function focusControl(control: N) {
  focusing.focus(control, focusing.SCRIPT);
  focusing.endAutofocus(control.doc);
}

function focusDialog(node: N) {
  const control = hasAttr(node, "autofocus") ? node : (focusing.focusDelegate(node) ?? node);
  if (focusing.isFocusable(control)) return focusControl(control);
  if (node.state & states.MODAL) focusing.setFocus(node.doc, null, focusing.SCRIPT);
  focusing.endAutofocus(node.doc);
}

function setUpDialog(node: N) {
  const { doc, x } = node;
  if (doc.page === null || x.watcher !== null) return;
  doc.openDialogs.push(node);
  x.watcher = new Watcher(
    doc.page,
    isCancelable => events.fire(node, "cancel", false, isCancelable),
    () => closeDialog(node, x.requestedValue, x.requestSource),
    () => x.isRequested || closedBy(node) !== "none",
  );
}

function cleanUpDialog(node: N) {
  node.doc.openDialogs = node.doc.openDialogs.filter(it => it !== node);
  node.x.watcher?.destroy();
  node.x.watcher = null;
}

function showDialog(node: N, modal: boolean, source: N | null = null) {
  if (hasAttr(node, "open")) {
    if (modal === ((node.state & states.MODAL) !== 0)) return;
    throw domError("InvalidStateError", "The dialog is already open in the other way.");
  }
  if (modal && (!(node.flags & CONNECTED) || node.doc.page === null || isShowing(node))) {
    throw domError("InvalidStateError", "The element is not in a Document, or it is open as a popover.");
  }
  if (!beforeToggle(node, true, source) || hasAttr(node, "open")) return;
  if (modal && (!(node.flags & CONNECTED) || isShowing(node))) return;
  const { doc } = node;
  queueToggle(node, true, source);
  core.setAttr(node, "open", "");
  node.x.previousFocus = doc.focused;
  if (modal) {
    setState(node, states.MODAL, true);
    setInTopLayer(node, true);
  }
  hideAbove(doc, popoverAround(core.flatParent(node)), false);
  focusDialog(node);
}

function leaveModal(node: N, doc = node.doc) {
  if (!(node.state & states.MODAL)) return;
  setState(node, states.MODAL, false);
  setInTopLayer(node, false, doc);
}

function closeDialog(node: N, result?: any, source: N | null = null) {
  if (!hasAttr(node, "open")) return;
  beforeToggle(node, false, source);
  if (!hasAttr(node, "open")) return;
  const { previousFocus } = node.x;
  const restoresFocus = node.state & states.MODAL || core.containsFlat(node, node.doc.focused);
  queueToggle(node, false, source);
  core.removeAttr(node, "open");
  leaveModal(node);
  if (result != null) node.x.returnValue = String(result);
  node.x.previousFocus = null;
  if (previousFocus !== null && restoresFocus) focusing.focus(previousFocus, focusing.SCRIPT, { preventScroll: true });
  (node.doc.page ?? core.realm.page).queueBeforeFrame(() => events.fire(node, "close"));
}

function requestClose(node: N, result: any = null, source: N | null = null) {
  const { x } = node;
  if (x.watcher === null || x.isRequested) return;
  Object.assign(x, { isRequested: true, requestedValue: result, requestSource: source });
  x.watcher.requestClose(false);
  Object.assign(x, { isRequested: false, requestedValue: null, requestSource: null });
}

define(
  "HTMLDialogElement",
  "dialog",
  "open?",
  () => ({
    get returnValue() {
      return (this as any).$impl.x.returnValue;
    },
    set returnValue(value) {
      (this as any).$impl.x.returnValue = String(value);
    },
    get closedBy() {
      return closedBy((this as any).$impl);
    },
    set closedBy(value) {
      core.setAttr((this as any).$impl, "closedby", String(value));
      core.react();
    },
    show(this: any) {
      showDialog(this.$impl, false);
    },
    showModal(this: any) {
      showDialog(this.$impl, true);
    },
    close(this: any, result: string | undefined = undefined) {
      closeDialog(this.$impl, result === null ? "null" : result);
    },
    requestClose(this: any, result: string | undefined = undefined) {
      requestClose(this.$impl, result === null ? "null" : result);
    },
  }),
  {
    created(node: N) {
      node.x = {
        returnValue: "",
        previousFocus: null,
        watcher: null,
        isRequested: false,
        requestedValue: null,
        requestSource: null,
      };
    },
    attribute: (node: N, name: string, _: unknown, value: string | null) =>
      name === "open" && node.flags & CONNECTED && (value === null ? cleanUpDialog : setUpDialog)(node),
    inserted: (node: N, isMove: boolean) => !isMove && hasAttr(node, "open") && setUpDialog(node),
    removed(node: N, _: N, isMove: boolean) {
      if (isMove) return;
      cleanUpDialog(node);
      leaveModal(node);
    },
  },
);

const commands = ["toggle-popover", "show-popover", "hide-popover", "close", "request-close", "show-modal"];

function commandOf(button: N): string {
  const command = getAttr(button, "command") ?? "";
  return command.startsWith("--") ? command : commands.includes(asciiLower(command)) ? asciiLower(command) : "";
}

/** `popovertarget` and `commandfor`. */
function invoke(button: N, origin: N) {
  const target = isHtml(button, "button") ? referenced(button, "commandfor")?.[0] : undefined;
  if (target === undefined) {
    const popover = popoverTarget(button);
    if (popover === null) return;
    if (popover !== button && core.containsComposed(popover, origin) && core.containsComposed(button, popover)) return;
    const action = asciiLower(getAttr(button, "popovertargetaction") ?? "");
    if (isShowing(popover)) {
      if (action !== "show") hidePopover(popover, false, true, button);
    } else if (action !== "hide") showPopover(popover, false, button);
    return;
  }
  const command = commandOf(button);
  const init = { command, source: wrap(button), cancelable: true, composed: true };
  if (command === "") return;
  if (!command.startsWith("--") && !(command.endsWith("popover") ? target.ns === HTML : isHtml(target, "dialog")))
    return;
  if (!events.dispatch(target, new events.CommandEvent("command", init)) || !(target.flags & CONNECTED)) return;
  const value = getAttr(button, "value");
  if (command === "hide-popover" || (command === "toggle-popover" && isShowing(target))) {
    hidePopover(target, false, true, button);
  } else if (command === "show-popover" || command === "toggle-popover") showPopover(target, false, button);
  else if (!isHtml(target, "dialog") || isShowing(target)) return;
  else if (command === "close") closeDialog(target, value, button);
  else if (command === "request-close") requestClose(target, value, button);
  else if (command === "show-modal" && !hasAttr(target, "open")) showDialog(target, true, button);
}

// ───────────────────────────── details ─────────────────────────────

function summaryOf(details: N): N | null {
  return core.elementChildren(details).find(child => isHtml(child, "summary")) ?? null;
}

function isDetailsSummary(node: N): boolean {
  return isHtml(node, "summary") && isHtml(node.parent, "details") && summaryOf(node.parent!) === node;
}

function othersInGroup(node: N): N[] {
  const name = getAttr(node, "name");
  if (!name) return [];
  const isOther = (it: N) =>
    it !== node &&
    (it.flags & CONNECTED) === (node.flags & CONNECTED) &&
    isHtml(it, "details") &&
    getAttr(it, "name") === name &&
    hasAttr(it, "open");
  return core.filterDescendants(core.rootOf(node), isOther);
}

function closeIfNotFirst(node: N) {
  if (hasAttr(node, "open") && othersInGroup(node).length > 0) core.removeAttr(node, "open");
}

const interactiveContent = `a[href],audio[controls],button,details,embed,iframe,img[usemap],input:not([type=hidden i]),label,
  select,textarea,video[controls]`;

function isInInteractiveContent(origin: N, within: N): boolean {
  for (let at: N | null = core.outOfControl(origin); at !== null && at !== within; at = at.parent) {
    if (at.type === core.ELEMENT && matches(at, interactiveContent)) return true;
  }
  return false;
}

define("HTMLDetailsElement", "details", "open? name", undefined, {
  shadow(node: N) {
    const make = (name: string) => core.createPlainElement(node.doc, name, HTML);
    const root = core.attachShadow(node, true);
    const [summarySlot, fallback, contentSlot] = [make("slot"), make("summary"), make("slot")];
    core.scopeOf(root).slotFor = (child: N) => (child === summaryOf(node) ? "summary" : "");
    core.setAttr(summarySlot, "name", "summary");
    core.setPseudo(fallback, "-internal-default-summary", node);
    core.setPseudo(contentSlot, "details-content", node);
    core.append(fallback, core.createText(node.doc, "Details"));
    core.append(summarySlot, fallback);
    core.append(root, summarySlot);
    core.append(root, contentSlot);
  },
  attribute(node: N, name: string, old: string | null, value: string | null) {
    if (name === "name") return closeIfNotFirst(node);
    if (name !== "open" || (old === null) === (value === null)) return;
    queueToggle(node, value !== null);
    if (value !== null) for (const other of othersInGroup(node)) core.removeAttr(other, "open");
  },
  inserted(node: N) {
    const isEarlier = (other: N) => !core.isBeingInserted(other) || core.compareOrder(other, node) < 0;
    if (hasAttr(node, "open") && othersInGroup(node).some(isEarlier)) core.removeAttr(node, "open");
  },
  activate(node: N, _: unknown, origin: N) {
    if (origin.flags & flags.USER_AGENT && core.outOfControl(origin) === node && summaryOf(node) === null) {
      core.toggleAttr(node, "open", !hasAttr(node, "open"));
    }
  },
});

core.kinds.html.$set(
  "summary",
  new core.Kind(core.kinds.htmlElement.ctor, {
    activate: (node: N, _: unknown, origin: N) =>
      isDetailsSummary(node) &&
      !isInInteractiveContent(origin, node) &&
      core.toggleAttr(node.parent!, "open", !hasAttr(node.parent!, "open")),
  }),
);

/** Opens what hides the node, for links to it and for search results. */
function reveal(node: N) {
  const isUntilFound = (it: N) => asciiLower(getAttr(it, "hidden") ?? "") === "until-found";
  const hiding: [N, boolean][] = [];
  for (let at: N | null = node; at !== null; at = core.flatParent(at) ?? at.parent) {
    if (isUntilFound(at)) hiding.push([at, false]);
    const { parent } = at;
    if (isHtml(parent, "details") && !isDetailsSummary(at) && !hasAttr(parent!, "open")) hiding.push([parent!, true]);
  }
  for (const [it, isDetails] of hiding) {
    if (!(it.flags & CONNECTED) || (isDetails ? hasAttr(it, "open") : !isUntilFound(it))) return;
    if (isDetails) core.toggleAttr(it, "open", true);
    else {
      events.fire(it, "beforematch", true);
      if (!(it.flags & CONNECTED) || !isUntilFound(it)) return;
      core.removeAttr(it, "hidden");
    }
  }
}

// ───────────────────────────── fullscreen ─────────────────────────────

function fullscreenElement(doc: Doc): N | null {
  return doc.topLayer.findLast(node => node.state & states.FULLSCREEN) ?? null;
}

function setFullscreen(node: N, on: boolean, doc = node.doc) {
  setState(node, states.FULLSCREEN, on);
  setInTopLayer(node, on, doc);
  if (!on) fullscreenFrames.delete(node);
  queueFullscreenEvent(node, "fullscreenchange", doc);
}

function queueFullscreenEvent(node: N, type: string, doc: Doc) {
  (doc.page!.fullscreenEvents ??= []).push(node, type);
  core.invalidate(doc);
}

/** https://fullscreen.spec.whatwg.org/#run-the-fullscreen-steps */
function fireFullscreenEvents(page: Page) {
  const pending = page.fullscreenEvents!;
  page.fullscreenEvents = null;
  for (let i = 0; i < pending.length; i += 2) {
    const node: N = pending[i];
    const target = node.flags & CONNECTED && node.doc === page.doc ? node : page.doc.node;
    events.fire(target, prefixedRequests.has(node) ? "webkit" + pending[i + 1] : pending[i + 1], true, false, true);
  }
}

/** The frames that were made fullscreen themselves, not for something in them. */
const fullscreenFrames = new WeakSet<N>();
const prefixedRequests = new WeakSet<N>();

const isFullscreenEnabled = (doc: Doc) => doc.page !== null && doc.page.host.allowsFeature?.("fullscreen") !== false;

function isReadyForFullscreen(node: N): boolean {
  const isKnown =
    node.ns === HTML || node.name === (node.ns === core.SVG ? "svg" : node.ns === core.MATHML ? "math" : "");
  return (
    isKnown &&
    (node.flags & CONNECTED) !== 0 &&
    isFullscreenEnabled(node.doc) &&
    !isShowing(node) &&
    !isHtml(node, "dialog")
  );
}

/** Also for the frame that has what was requested. */
function enterFullscreen(node: N) {
  const { doc } = node;
  if (fullscreenElement(doc) !== node) {
    hideAbove(doc, popoverAround(node), false);
    setFullscreen(node, true);
  }
  const { container } = doc;
  if (container !== null) container.enterFullscreen();
  else doc.page!.host.fullscreen?.(true);
}

async function requestFullscreen(node: N, options: any) {
  const { doc } = node;
  const { page } = doc;
  if (options !== null && !$isObject(options)) throw new TypeError("The options are not a dictionary.");
  const { keyboardLock = "none", navigationUI = "auto" } = options ?? {};
  if (!["auto", "show", "hide"].includes(`${navigationUI}`) || !["browser", "none"].includes(`${keyboardLock}`)) {
    throw new TypeError("The provided value is not a valid enum value.");
  }
  if (page === null) throw new TypeError("Document not active");
  const isAllowed = isReadyForFullscreen(node) && page.consumeActivation();
  await new Promise<void>(resolve => page.queueTask(resolve));
  if (!isAllowed || !isReadyForFullscreen(node) || node.doc !== doc) {
    if (doc.page !== null) queueFullscreenEvent(node, "fullscreenerror", doc);
    throw new TypeError("fullscreen error");
  }
  enterFullscreen(node);
  if (isHtml(node, "iframe")) fullscreenFrames.add(node);
}

const fullscreenStack = (doc: Doc) => doc.topLayer.filter(node => node.state & states.FULLSCREEN);

function unfullscreenAll(page: Page) {
  const top = fullscreenElement(page.doc);
  for (const node of fullscreenStack(page.doc)) {
    if (node === top) continue;
    setState(node, states.FULLSCREEN, false);
    setInTopLayer(node, false);
  }
  if (top !== null) setFullscreen(top, false);
}

/** `forFrame`: what was fullscreen in that frame no longer is. */
function leaveFullscreen(doc: Doc, forFrame: N | null) {
  const top = fullscreenElement(doc);
  if (forFrame !== null && (top !== forFrame || fullscreenFrames.has(forFrame))) return;
  if (top !== null) setFullscreen(top, false);
  if (fullscreenElement(doc) !== null) return;
  const { container } = doc;
  if (container !== null) container.leaveFullscreen();
  else doc.page!.host.fullscreen?.(false);
}

async function exitFullscreen(doc: Doc) {
  const { page } = doc;
  const top = fullscreenElement(doc);
  if (page === null || top === null) throw new TypeError("Document not active");
  await new Promise<void>(resolve => page.queueTask(resolve));
  if (fullscreenElement(doc) === null) return;
  leaveFullscreen(doc, null);
  for (const below of page.below()) below.unfullscreenAll();
}

function exitFullscreenFully(page: Page): boolean {
  const all = page.tree();
  if (fullscreenElement(all[0].doc) === null) return false;
  for (const it of all) it.unfullscreenAll();
  all[0].host.fullscreen?.(false);
  return true;
}

const transitions = () => require("internal/desktop/dom/view_transition");
const transitionScope = (node: N) => (node === core.documentElement(node.doc) ? null : node);

function requestPrefixed(this: any, options: any = {}) {
  prefixedRequests.add(this.$impl);
  requestFullscreen(this.$impl, options).catch(() => {});
}

core.mixin(
  {
    async requestFullscreen(this: any, options: any = {}) {
      prefixedRequests.delete(this.$impl);
      await requestFullscreen(this.$impl, options);
    },
    startViewTransition(this: any, update: any = undefined) {
      const node: N = this.$impl;
      return transitions().start(node.doc.page, update, transitionScope(node));
    },
    get activeViewTransition() {
      const node: N = (this as any).$impl;
      const { page } = node.doc;
      return (page && transitions().active(page, transitionScope(node))?.js) ?? null;
    },
    webkitRequestFullscreen: requestPrefixed,
    webkitRequestFullScreen: requestPrefixed,
  },
  Element,
);

/** Before `removed` leaves the document. */
function leaveTopLayer(doc: Doc, removed: N) {
  const top = fullscreenElement(doc);
  for (const node of fullscreenStack(doc)) {
    if (!core.containsComposed(removed, node)) continue;
    if (node !== top) {
      setState(node, states.FULLSCREEN, false);
      setInTopLayer(node, false);
      continue;
    }
    setFullscreen(node, false);
    prefixedRequests.delete(node);
    doc.page!.queueTask(() => leaveFullscreen(doc, null));
  }
}

hooks.hidePopover = hidePopover;
hooks.isDetailsSummary = isDetailsSummary;
hooks.popoverState = popoverState;
hooks.showPopover = showPopover;
hooks.togglePopover = togglePopover;
hooks.topModal = topModal;
hooks.invokedPopover = node => node.doc.topLayer.find(it => it.rare?.popover?.invoker === node) ?? null;
hooks.popoverRemoved = node => hidePopover(node, false, false, null, false, true);
hooks.globalAttribute = (node, name, _, value) => {
  if (name === "nonce") rare(node).nonce = value ?? "";
  else if (name === "elementtiming") (node.doc.page ?? core.realm.page).timing().watch(node);
  else if (name === "autofocus")
    node.flags = value === null ? node.flags & ~flags.AUTOFOCUS : node.flags | flags.AUTOFOCUS;
  else if (isShowing(node) && popoverState(node) !== node.rare!.popover!.type)
    hidePopover(node, false, true, null, true, true);
};

export default {
  closeDialog,
  closeTopmost,
  commandOf,
  enterFullscreen,
  exitFullscreen,
  exitFullscreenFully,
  fireFullscreenEvents,
  fullscreenElement,
  hidePopover,
  invoke,
  isFullscreenEnabled,
  isInInteractiveContent,
  leaveFullscreen,
  leaveTopLayer,
  lightDismiss,
  reveal,
  setInTopLayer,
  showPopover,
  summaryOf,
  unfullscreenAll,
};
