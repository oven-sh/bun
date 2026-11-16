// https://drafts.csswg.org/css-view-transitions-2/
const core = require("internal/desktop/dom/core");

const { domError, expose, invalidate, sync } = core;
type Page = $Dom.Page;

const enum Phase {
  PendingCapture,
  UpdateCallbackCalled,
  Animating,
  Done,
}
const enum Step {
  CaptureOld,
  CaptureNew,
  Follow,
  End,
  HandOver,
  TakeOver,
}
const TIMEOUT = 4000;
const reserved = /^(?:none$|-ua-)/i;

function setState(page: Page, name: string, on: boolean) {
  const root = core.documentElement(page.doc);
  if (root === null) return;
  sync(page.doc).setCustomState(root.id, name, on);
  invalidate(page.doc);
}

class Transition {
  page: Page;
  update: Function | null;
  phase = Phase.PendingCapture;
  types = new Set<string>();
  updated = Promise.withResolvers<void>();
  ready = Promise.withResolvers<void>();
  finished = Promise.withResolvers<void>();
  waits = 0;
  timer: any = null;
  js: any = null;
  typeSet: any = null;
  isInbound = false;

  constructor(page: Page, update: Function | null) {
    this.page = page;
    this.update = update;
  }

  isActive(): boolean {
    return this.page.transition === this;
  }

  showType(type: string, on: boolean) {
    if (this.isActive() && !reserved.test(type)) setState(this.page, ":type " + type, on);
  }

  setActive(on: boolean) {
    const { page } = this;
    page.transition = this;
    for (const type of this.types) this.showType(type, on);
    setState(page, ":active-view-transition", on);
    if (on) return;
    page.transition = null;
    page.suppressesRendering = false;
    clearTimeout(this.timer);
    if (!page.isDisposed) page.doc.engine.viewTransition(Step.End, 0);
  }

  callUpdate() {
    if (this.phase !== Phase.Done) this.phase = Phase.UpdateCallbackCalled;
    if (this.isActive()) {
      this.timer = setTimeout(
        () => this.skip(domError("TimeoutError", "Transition was aborted because of timeout in DOM update")),
        TIMEOUT,
      );
    }
    const { update } = this;
    new Promise(resolve => resolve(update?.())).then(
      () => {
        this.updated.resolve();
        this.activate();
      },
      error => {
        this.updated.reject(error);
        if (this.phase === Phase.Done) return;
        this.skip(error);
      },
    );
  }

  activate() {
    const { page } = this;
    if (this.phase === Phase.Done) return;
    clearTimeout(this.timer);
    page.suppressesRendering = false;
    if (sync(page.doc).viewTransition(Step.CaptureNew, 0) === 0) return this.fail();
    this.phase = Phase.Animating;
    this.ready.resolve();
    invalidate(page.doc);
  }

  fail() {
    this.skip(domError("InvalidStateError", "Transition was aborted because of invalid state"));
  }

  skip(reason: unknown) {
    if (this.phase === Phase.Done) return;
    if (this.phase === Phase.PendingCapture) schedule(this);
    if (this.isActive()) this.setActive(false);
    this.phase = Phase.Done;
    this.ready.reject(reason);
    this.finished.resolve(this.updated.promise);
  }

  /** Before each paint. */
  perform(canvas: number) {
    const { page } = this;
    if (this.phase === Phase.PendingCapture) {
      flush(page);
      if (!this.isActive()) return;
      if (sync(page.doc).viewTransition(Step.CaptureOld, canvas) === 0) return this.fail();
      page.suppressesRendering = true;
      this.phase = Phase.UpdateCallbackCalled;
      schedule(this);
    } else if (this.phase === Phase.Animating) {
      const state = sync(page.doc).viewTransition(Step.Follow, 0);
      if (state === 0 || (this.isInbound && typesForNavigation(page) === null)) return this.fail();
      if (state === 2 || this.waits > 0) return;
      page.queueTask(() => this.finish());
    }
  }

  finish() {
    if (this.phase === Phase.Done) return;
    this.setActive(false);
    this.phase = Phase.Done;
    this.finished.resolve();
  }
}

const queues = new WeakMap<object, Transition[]>();

function schedule(transition: Transition) {
  const { page } = transition;
  if (!queues.has(page)) queues.set(page, []);
  queues.get(page)!.push(transition);
  page.queueTask(() => flush(page));
}

function flush(page: Page) {
  for (const transition of queues.get(page)?.splice(0) ?? []) transition.callUpdate();
}

class ViewTransitionTypeSet {
  declare $impl: Transition;
  constructor() {
    core.illegalConstructor();
  }
  get size() {
    return this.$impl.types.size;
  }
  has(type: string) {
    return this.$impl.types.has(`${type}`);
  }
  add(type: string) {
    this.$impl.types.add((type = `${type}`));
    this.$impl.showType(type, true);
    return this;
  }
  delete(type: string) {
    this.$impl.showType((type = `${type}`), false);
    return this.$impl.types.delete(type);
  }
  clear() {
    for (const type of this.$impl.types) this.$impl.showType(type, false);
    this.$impl.types.clear();
  }
  entries() {
    return this.$impl.types.entries();
  }
  values() {
    return this.$impl.types.values();
  }
  forEach(callback: Function, thisArg: unknown = undefined) {
    for (const type of this.$impl.types) callback.$call(thisArg, type, type, this);
  }
}
for (const key of ["keys", Symbol.iterator]) {
  const value = ViewTransitionTypeSet.prototype.values;
  Object.defineProperty(ViewTransitionTypeSet.prototype, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: key === "keys",
  });
}
expose(ViewTransitionTypeSet);

class ViewTransition {
  declare $impl: Transition;
  constructor() {
    core.illegalConstructor();
  }
  get updateCallbackDone() {
    return this.$impl.updated.promise;
  }
  get ready() {
    return this.$impl.ready.promise;
  }
  get finished() {
    return this.$impl.finished.promise;
  }
  get types() {
    return (this.$impl.typeSet ??= make(ViewTransitionTypeSet, this.$impl));
  }
  get transitionRoot() {
    return core.wrapOrNull(core.documentElement(this.$impl.page.doc));
  }
  skipTransition() {
    this.$impl.skip(domError("AbortError", "Transition was skipped"));
  }
  waitUntil(promise: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    const it = this.$impl;
    const done = () => {
      it.waits--;
      invalidate(it.page.doc);
    };
    it.waits++;
    Promise.$resolve(promise).$then(done, done);
  }
}
expose(ViewTransition);

function make(ctor: any, impl: Transition) {
  const made = Object.create(ctor.prototype);
  made.$impl = impl;
  return made;
}

function start(page: Page | null, argument: any) {
  const update = $isCallable(argument) ? argument : (argument?.update ?? null);
  if (update !== null && !$isCallable(update)) throw new TypeError("The update callback is not a function.");
  const transition = new Transition(page ?? core.realm.page, update);
  if (update !== argument) for (const type of argument?.types ?? []) transition.types.add(`${type}`);
  transition.js = make(ViewTransition, transition);
  if (page === null) transition.skip(domError("AbortError", "The document has no window"));
  else if (!page.isVisible) transition.fail();
  else {
    page.transition?.skip(domError("AbortError", "Transition was skipped because a new one started"));
    transition.setActive(true);
  }
  return transition.js;
}

function typesForNavigation(page: Page): string[] | null {
  const types: string = sync(page.doc).computedStyle(1, "", "@view-transition");
  return types === "none" ? null : types.split(" ").filter(Boolean);
}

function forNavigation(page: Page, types: string[]): Transition {
  const transition = new Transition(page, null);
  for (const type of types) transition.types.add(type);
  transition.js = make(ViewTransition, transition);
  $pokePromiseAsHandled(transition.ready.promise);
  transition.updated.resolve();
  return transition;
}

/** Returns what `reveal` takes. */
function swap(page: Page, canvas: number, fire: (transition: object | null) => void): number {
  const types = page.isRevealed && page.isVisible ? typesForNavigation(page) : null;
  if (types === null) return (fire(null), 0);
  page.transition?.skip(domError("AbortError", "Transition was skipped because navigation started"));
  const transition = forNavigation(page, types);
  transition.phase = Phase.UpdateCallbackCalled;
  transition.setActive(true);
  fire(transition.js);
  if (!transition.isActive()) return 0;
  const ticket =
    sync(page.doc).viewTransition(Step.CaptureOld, canvas) === 0 ? 0 : (Math.random() * 0x7ffffffe + 1) | 0;
  if (ticket !== 0) page.doc.engine.viewTransition(Step.HandOver, ticket);
  transition.fail();
  return ticket;
}

function reveal(page: Page, ticket: number, fire: (transition: object | null) => void) {
  const types = page.transition === null && page.isVisible ? typesForNavigation(page) : null;
  if (types === null || page.doc.engine.viewTransition(Step.TakeOver, ticket) === 0) return fire(null);
  const transition = forNavigation(page, types);
  transition.phase = Phase.UpdateCallbackCalled;
  transition.isInbound = true;
  transition.setActive(true);
  fire(transition.js);
  transition.activate();
  require("internal/desktop/dom/events").microtaskCheckpoint();
}

export default { reveal, start, swap };
