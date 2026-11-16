// What a window has besides its document, and what it does for each frame.
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const animation = require("internal/desktop/dom/animation");
const cssom = require("internal/desktop/dom/cssom");
const documents = require("internal/desktop/dom/document");
const editing = require("internal/desktop/dom/editing");
const focusing = require("internal/desktop/dom/focus");
const html = require("internal/desktop/dom/html");
const input = require("internal/desktop/dom/input");
const interactive = require("internal/desktop/dom/interactive");
const loader = require("internal/desktop/dom/loader");
const observers = require("internal/desktop/dom/observers");
const ranges = require("internal/desktop/dom/range");
const { createRegistry } = require("internal/desktop/dom/custom");
const { formOf, textControl } = require("internal/desktop/dom/forms");

const { N, asciiLower, getAttr, invalidate, isHtml, states, sync } = core;

const overlaysScrollbars = process.platform === "darwin" || process.env.BUN_DESKTOP_OVERLAY_SCROLLBARS === "1";

type N = $Dom.N;
type Doc = $Dom.Doc;
type Display = { x: number; y: number; width: number; height: number };
type Environment = {
  dark?: boolean;
  reducedMotion?: boolean;
  moreContrast?: boolean;
  reducedTransparency?: boolean;
  /** 0xRRGGBBAA */
  accent?: number;
  screen?: { bounds: Display; workArea: Display; colorDepth?: number };
  zoom?: number;
  active?: boolean;
  visible?: boolean;
  fullscreen?: boolean;
  transparent?: boolean;
  overlayScrollbars?: boolean;
  titlebarArea?: Display;
  windowBounds?: Display;
  languages?: string[];
};
type Entry = {
  key: string;
  id: string;
  url: string;
  /** Both are serialized. */
  state: unknown;
  navigationState: unknown;
  scroll?: number[];
  scrollRestoration: string;
  isOfDocument: boolean;
  js: any;
};

declare global {
  namespace $Dom {
    type Page = PageImpl;
    type Entry = EntryImpl;
  }
}
type PageImpl = Page;
type EntryImpl = Entry;

const DARK_CANVAS = 0x121212ff;
/** Of `styleBits` */
const DARK = 1 << 17;
const HAS_SCHEME = 1 << 18;
const ACCESSIBILITY_DELAY = 150;

function runTask(_: Page, task: () => void) {
  task();
}

class Page {
  host: any;
  native: any;
  surface: number;
  fontScope: number;
  url: string;
  doc: Doc;
  window: any;
  /** Other than the mouse. */
  pointers: any = null;
  /** While `mouse` is one of them. */
  systemMouse: $Dom.Mouse | null = null;
  /** What has the listeners of `window`. */
  target: N;
  event: object | undefined = undefined;
  isDisposed = false;
  isUnloading = false;

  environment: Environment = {};
  surfaceWidth = 800;
  surfaceHeight = 600;
  surfaceScale = 1;
  /** In CSS pixels. */
  width = 800;
  height = 600;
  zoom = 1;
  scale = 1;
  isVisible = true;
  isFocused = false;
  wasResized = false;
  environmentChanged = false;
  /** The media queries that have listeners, and whether they matched. */
  watchedQueries = new Map<any, boolean>();
  scrollRequests = new Map<number, (result: object) => void>();
  background = -1;

  timeOrigin = performance.now();
  /** When the steps of loading and painting happened. */
  milestones: Record<string, number> = {};
  onMilestone: ((name: string, time: number) => void) | null = null;
  /** Set if the document requires Trusted Types. */
  trusted: ((kind: string, value: unknown, sink: string) => string) | null = null;
  frameTime = performance.now();
  tasks: any;
  frameTimer: any = null;
  watched = new observers.Watched();
  wakeTimer: any = null;
  frameCallbacks = new Map<number, Function>();
  nextCallback = 1;
  /** Of `frameCallbacks`: they run before the events of the frame, as a task would. */
  earlyCallbacks: number[] = [];
  needsAnotherFrame = false;
  isInFrame = false;
  hasPainted = false;
  sizesVersion = -1;
  layoutVersion = -1;
  hasNewObservations = false;
  timeline: object;
  animations = new Map<number, $Dom.Player>();
  engineEvents: any[][] = [];

  mouse = new input.Mouse();
  pressedKey: object | null = null;
  composition: $Dom.Composition | null = null;
  inputMethodState = new editing.InputMethodState();
  transition: any = null;
  suppressesRendering = false;
  openPicker: { node: N; close(): void } | null = null;
  bubble = 0;
  lastInputWasMouse = false;
  lastFocusWasMouse = false;
  hadKey = false;
  hidesFocus = false;
  activatedAt = -Infinity;
  isExecutingCommand = false;
  focusSerial = 0;
  selectionSerial = 0;
  tabStart: N | null = null;
  /** Once what `tabStart` was is gone: the place is after `tabStart` (1), or before its first child (2). */
  tabGap = 0;
  autofocusCandidates: N[] = [];
  /** In groups. */
  closeWatchers: any[][] = [];
  allowedWatcherGroups = 1;
  activationAllowsWatcherGroup = true;
  hasBeenActive = false;
  hasHistoryActionActivation = false;
  fullscreenEvents: any[] | null = null;
  pressedLayers: any = null;
  /** What gets a `selectionchange` event. */
  changedSelections = new Set<N>();
  highlights: any = undefined;
  paintedHighlights = new Set<string>();
  spelling: any = null;
  isAccessible = false;
  accessibilityTimer: any = null;

  injectedSheets = new Map<string, $Dom.Sheet>();
  blockingSheets = new Set<Promise<unknown>>();
  /** With whether they still are. */
  renderBlockers = new Map<N, () => boolean>();
  deferredScripts: Promise<() => unknown>[] = [];
  orderedScripts: Promise<unknown> = Promise.$resolve();
  loadDelays = 0;
  isCompletelyLoaded = false;
  isRevealed = false;
  navigationSerial = 0;
  pictures = new Map<string, $Dom.Picture>();
  unusedPictures = new Set<$Dom.Picture>();
  timings: $Dom.Timing | null = null;
  onTiming: ((values: object) => void) | null = null;
  beforeFrame: (() => void)[] = [];
  /** By an `IntersectionObserver` whose root is the viewport at the top. */
  isObservedFromFrames = false;
  /** The title of the style sheets that apply. */
  preferredSheets = "";
  hasColorScheme = false;
  hadInput = false;
  inputTime = 0;
  unpaintedSince = 0;
  earlyPaintsLeft: int32 = 0;
  hasPaintedContent = false;
  lazyImages = new Set<N>();
  autoSizedImages = new Set<N>();
  responsiveImages: WeakRef<N>[] = [];
  plugins = new Set<N>();
  fonts: any = null;
  frames = new Set<N>();
  hasRemoteFrames = false;
  frameUnderMouse: N | null = null;
  isHeldInFrame = false;
  focusedFrame: N | null = null;
  touchedFrame: N | null = null;
  fingersDown = 0;
  isTabbing = false;
  frameCount = 0;
  frameElement: N | null = null;
  hasDirtyFrames = false;
  /** For a window of another realm than this module. */
  mirror: any;
  /** The element that shows this page, which may be of another origin. */
  container: any;
  sizesContainer = false;
  hasFocusedControl = false;
  title = "";

  entries: Entry[] = [];
  entryIndex = 0;
  /** The objects that getters of `window` return again. */
  same = new Map<string, any>();
  createPage: (host: object) => any;

  constructor(host: any, window: any, createPage: Function, baseUrl?: string, mirror: any = null) {
    this.host = host;
    this.mirror = mirror;
    this.container = host.container ?? null;
    this.frameElement = host.frameElement ?? null;
    this.native = host.native ?? null;
    this.tasks = host.tasks ?? require("internal/desktop/tasks");
    this.surface = host.surface ?? 0;
    this.fontScope = host.fontScope ?? this.surface;
    this.url = host.url ?? "about:blank";
    this.window = window;
    this.createPage = host => createPage(host, { baseUrl: this.doc.baseUrl });
    this.target = new N(0, null!, core.noKind);
    this.target.js = window;
    this.target.x = this;
    window.$impl = this.target;
    this.doc = documents.createHtmlDoc(this);
    if (baseUrl !== undefined && this.url.startsWith("about:")) {
      this.doc.engine.setBaseUrl((this.doc.baseUrl = this.doc.fallbackBaseUrl = baseUrl));
    }
    this.doc.encoding = host.encoding ?? "utf-8";
    this.doc.contentType = host.contentType ?? "text/html";
    this.doc.lastModified = host.lastModified ?? null;
    if (host.language) this.doc.engine.setLanguage(host.language);
    this.doc.registry = createRegistry(this.doc);
    this.timeline = animation.createTimeline(this);
    if (this.surface !== 0) this.attach(this.surface);
    else this.readEnvironment();
  }

  /** Another document for the same window. */
  renew(url: string, baseUrl?: string) {
    const old = this.doc;
    input.cancelGestures(this);
    for (const node of Array.from(this.frames)) loader.closeFrame(node);
    core.replaceAll(null, old.node);
    old.page = old.container = null;
    old.scheduled = true;
    this.url = url;
    this.doc = documents.createHtmlDoc(this);
    this.doc.encoding = this.host.encoding ?? "utf-8";
    this.doc.contentType = this.host.contentType ?? "text/html";
    this.doc.lastModified = this.host.lastModified ?? null;
    this.doc.engine.setLanguage(this.host.language ?? "");
    if (baseUrl !== undefined) this.doc.engine.setBaseUrl((this.doc.baseUrl = this.doc.fallbackBaseUrl = baseUrl));
    this.doc.registry = old.registry;
    this.doc.registry.$impl.doc = this.doc;
    old.registry = null;
    this.timeline = animation.createTimeline(this);
    this.animations.clear();
    this.injectedSheets.clear();
    this.entries = [];
    this.fonts = null;
    this.loadDelays = 0;
    this.isCompletelyLoaded = this.isRevealed = false;
    this.same.$delete("refresh");
    this.layoutVersion = this.sizesVersion = -1;
    this.attach(this.surface);
  }

  attach(surface: number) {
    this.native = this.host.native;
    clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.doc.scheduled = this.hasPainted = false;
    this.doc.engine.fontsChanged();
    const { width, height, scale } = this.native.ask("surface.size", { id: surface });
    this.surface = surface;
    if (this.native.options.composited && !this.native.options.headless && this.container === null)
      this.doc.engine.setComposited(true);
    this.resize(width, height, scale);
  }

  resize(width: number, height: number, scale: number) {
    this.surfaceWidth = width;
    this.surfaceHeight = height;
    this.surfaceScale = scale;
    this.readEnvironment();
  }

  readEnvironment() {
    const it: Environment = (this.environment = this.host.environment?.() ?? {});
    const scheme = this.container?.colorScheme() ?? 0;
    if (scheme & HAS_SCHEME) it.dark = (scheme & DARK) !== 0;
    const zoom = (this.zoom = it.zoom ?? 1);
    const [width, height, scale] = [this.surfaceWidth / zoom, this.surfaceHeight / zoom, this.surfaceScale * zoom];
    const screen = it.screen?.bounds ?? { width, height };
    const bar = it.titlebarArea;
    this.wasResized ||= width !== this.width || height !== this.height || scale !== this.scale;
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.environmentChanged = true;
    this.doc.engine.setEnvironment(
      [width, height, scale, zoom, screen.width, screen.height, it.accent ?? 0x0075ffff].concat(
        bar ? [bar.x / zoom, bar.y / zoom, bar.width / zoom, bar.height / zoom] : [NaN, NaN, NaN, NaN],
      ),
      (it.dark ? 1 : 0) |
        (it.reducedMotion ? 2 : 0) |
        (it.moreContrast ? 4 : 0) |
        (it.fullscreen ? 8 : 0) |
        ((it.overlayScrollbars ?? overlaysScrollbars) ? 16 : 0) |
        ((it.active ?? true) ? 32 : 0) |
        (it.reducedTransparency ? 64 : 0) |
        (/^(?:no|off|noscroll)$/i.test(this.container?.attribute("scrolling") ?? "") ? 128 : 0),
    );
    if (this.isVisible !== (it.visible ?? true)) {
      this.layoutVersion = this.sizesVersion = -1;
      this.isVisible = !this.isVisible;
      this.doc.scheduled = false;
      if (!this.isVisible) this.transition?.fail();
      this.queueTask(() => events.fire(this.doc.node, "visibilitychange", true));
    }
    invalidate(this.doc);
  }

  queueTask(task: () => void) {
    const run = () => this.isDisposed || events.fromEventLoop(runTask, this, task);
    this.tasks.post(this.tasks.VISIBLE, run);
  }

  /** For a reaction to a promise that no script has. */
  runAsTask(task: () => void) {
    events.fromEventLoop(runTask, this, task);
  }

  /** A task that the next frame does not overtake. */
  queueBeforeFrame(task: () => void) {
    if (this.beforeFrame.push(task) === 1) this.queueTask(() => this.runBeforeFrame());
  }

  runBeforeFrame() {
    for (const task of this.beforeFrame.splice(0)) task();
  }

  reportError(error: any) {
    if (this.host.reportError) return this.host.reportError(error);
    const init = {
      error,
      message: "Uncaught " + (Error.isError(error) ? error.name + ": " + error.message : String(error)),
      filename: error?.sourceURL ?? this.doc.url,
      lineno: error?.line,
      colno: error?.column,
      cancelable: true,
    };
    const isReporting = this.event instanceof events.ErrorEvent;
    if (isReporting || events.dispatchFromScript(this.target, new events.ErrorEvent("error", init), true))
      console.error(error);
  }

  compileHandler(source: string, type: string, node: N) {
    if (this.host.runsScripts === false) return null;
    const isWindows = (isHtml(node, "body") || isHtml(node, "frameset")) && events.reflectedByBody.includes(type);
    const names = type === "error" && isWindows ? "event,source,lineno,colno,error" : "event";
    const scopes = isWindows
      ? [{}, {}, {}]
      : [core.wrapOrNull(this.doc.node), core.wrapOrNull(formOf(node)) ?? {}, core.wrapOrNull(node)];
    // The name of a function expression would hide a global of that name.
    const name = source.includes("on" + type) ? "" : " on" + type;
    const text = `with(this[0])with(this[1])with(this[2])return function${name}(${names}) {\n${source}\n}`;
    return (this.host.compileHandler ?? Function)(text).$call(scopes);
  }

  // ─────────────── frames ───────────────

  schedule() {
    if (this.isDisposed || (!this.isVisible && this.hasPainted)) return;
    if (this.container !== null) return this.container.schedule();
    if (this.surface !== 0) {
      this.native.requestFrame(this.surface);
      this.tasks.wantsFrame(this);
    } else this.frameTimer ??= setTimeout(events.fromEventLoop, 16, updateRendering, this);
  }

  /** What an event has changed does not wait for the display. */
  renderNow() {
    if (this.doc.scheduled && this.surface !== 0 && this.container === null) updateRendering(this);
  }

  /** For a script that takes long to answer input: shows what it has so far, unless an observer has yet to hear of a new size. */
  paintNow(deliversResizes: boolean) {
    const now = performance.now();
    if (
      this.earlyPaintsLeft === 0 ||
      now - this.unpaintedSince < EARLY_PAINT_AFTER ||
      now - this.inputTime > EARLY_PAINT_UNTIL
    )
      return;
    if (
      this.isInFrame ||
      this.surface === 0 ||
      this.container !== null ||
      this.transition !== null ||
      this.suppressesRendering
    )
      return;
    if (!this.hasPainted || this.isDisposed || this.wasResized || !this.doc.scheduled) return;
    const engine = sync(this.doc);
    engine.setTime(now);
    engine.updateLayout();
    if (deliversResizes) {
      for (let depth = 0; (depth = observers.deliverResizes(this, depth)) !== Infinity && depth >= 0;)
        sync(this.doc).updateLayout();
    } else if (observers.hasResizedBoxes(this)) return;
    this.earlyPaintsLeft--;
    showSelection(this);
    engine.paint(this.surface);
    this.unpaintedSince = performance.now();
  }

  gotInput() {
    this.inputTime = this.unpaintedSince = performance.now();
    this.earlyPaintsLeft = 2;
  }

  isAwaited() {
    return this.frameCallbacks.size > 0 || this.doc.needsSync || (this.doc.engine.pending() & 8) !== 0;
  }

  render() {
    if (this.doc.scheduled) events.fromEventLoop(updateRendering, this);
  }

  /** When the page around it is rendered. */
  renderInFrame() {
    if (this.doc.scheduled || this.hasDirtyFrames) updateRendering(this);
  }

  handleEvent(event: any) {
    if (!this.isDisposed) events.fromEventLoop(handleEvent, this, event);
  }

  scroll(axis: number): number {
    return sync(this.doc).metric(1, 4 + axis);
  }

  topLayerChanged() {
    const ids = this.doc.topLayer.map(node => node.id).filter(Boolean);
    if (this.bubble !== 0) ids.push(this.bubble);
    this.doc.engine.setTopLayer(ids);
    if (this.doc.focused !== null) core.hooks.markFocus(this.doc, true);
    invalidate(this.doc);
  }

  setSheet(key: string, text: string | null) {
    this.injectedSheets.$get(key)?.dispose();
    if (text === null) this.injectedSheets.$delete(key);
    else this.injectedSheets.$set(key, new cssom.Sheet(text, this.doc.baseUrl));
    core.dirtyScope(this.doc.node);
  }

  // ─────────────── focus and selection ───────────────

  beforeRemove(node: N, isMove: boolean) {
    const { doc } = this;
    if (this.tabStart !== null && core.containsComposed(node, this.tabStart)) focusing.startTabbingInPlaceOf(node);
    if (isMove) return;
    if ((node.state & states.FOCUS_WITHIN || doc.topLayer.length > 0) && core.containsComposed(node, doc.focused)) {
      this.openPicker?.close();
      focusing.dropFocus(doc, node);
    }
    if (doc.topLayer.length > 0) interactive.leaveTopLayer(doc, node);
    if (node.parent === doc.node) this.hideBubble();
    input.forget(this, node);
  }

  focusChanged() {
    if (this.composition !== null && this.composition.target !== editing.editTarget(this.doc)) this.composition = null;
    if (this.hasRemoteFrames) require("internal/desktop/dom/remote_frame").focusChanged(this);
    if (this.container !== null && this.doc.focused !== null) this.container.focus();
    invalidate(this.doc);
  }

  selectionChanged() {
    const { doc } = this;
    const selection = doc.selection!;
    const control = selection.range === null ? null : textControl(core.outOfControl(selection.r!.startNode));
    control?.readSelection(selection);
    this.selectionSerial++;
    this.controlSelectionChanged(control === null ? doc.node : control.node);
    doc.needsSync = doc.isSelectionUnsent = true;
    invalidate(doc);
  }

  controlSelectionChanged(target: N) {
    const changed = this.changedSelections;
    if (changed.size === 0) this.queueTask(() => fireSelectionEvents(this));
    changed.$add(target);
  }

  endComposition() {
    editing.endComposition(this);
  }

  noteUserActivation(isMouse: boolean) {
    this.lastInputWasMouse = isMouse;
    this.noteActivationAbove();
    this.container?.activated(isMouse);
  }

  #activate() {
    this.activatedAt = performance.now();
    this.hasBeenActive = this.hasHistoryActionActivation = true;
    if (this.activationAllowsWatcherGroup) this.allowedWatcherGroups++;
    this.activationAllowsWatcherGroup = false;
  }

  consumeActivation(): boolean {
    const wasActive = this.isActive();
    if (wasActive) for (const page of this.tree()) page.activatedAt = -Infinity;
    return wasActive;
  }

  /** The pages around this frame, from the inside out. They and those below may be of other realms. */
  above(): Page[] {
    return this.container === null ? [] : [this.container.page, ...this.container.page.above()];
  }

  below(): Page[] {
    if (!this.hasRemoteFrames) return [];
    const inFrames: Page[] = loader.framesOf(this).flatMap(node => core.hooks.frameOf(node).local?.page() ?? []);
    return inFrames.flatMap(page => [page, ...page.below()]);
  }

  /** The top first. */
  tree(): Page[] {
    const top = this.above().at(-1) ?? this;
    return [top, ...top.below()];
  }

  topOfSameOrigin(): Page | null {
    const above = this.above();
    return above.every(page => page.host.owner.originKey === this.host.owner.originKey) ? (above.at(-1) ?? this) : null;
  }

  unfullscreenAll() {
    interactive.unfullscreenAll(this);
  }

  noteActivationAbove() {
    this.#activate();
    if (this.hasRemoteFrames) for (const node of this.frames) node.x.local?.activate();
  }

  noteActivationBelow(isMouse: boolean) {
    this.lastInputWasMouse = isMouse;
    this.#activate();
    this.container?.activated(isMouse);
  }

  isActive() {
    return performance.now() - this.activatedAt < 5000;
  }

  trackMouse(onMove: (x: number, y: number) => void, onRelease: () => void) {
    this.mouse.onMove = onMove;
    this.mouse.onRelease = onRelease;
  }

  showBubble(anchor: N, text: string) {
    const [left, top, , height] = html.boundingRect(anchor);
    this.showBubbleAt(left, top + height + 4, text);
  }

  /** Where the viewport is in that of the outermost page. */
  offsetInTop(): number[] {
    if (this.container === null) return [0, 0];
    const [[x, y], [left, top]] = [this.container.origin(), this.container.page.offsetInTop()];
    return [x + left, y + top];
  }

  showBubbleAt(x: number, y: number, text: string) {
    const root = core.documentElement(this.doc);
    const { engine } = this.doc;
    this.hideBubble();
    if (root === null) return;
    const id = (this.bubble = engine.createElement("div", core.HTML));
    engine.setPseudo(id, "-internal-bubble", root.id);
    engine.insert(id, engine.createText(text), 0);
    engine.setAttribute(id, "style", "left:0;top:0");
    engine.insert(1, id, 0);
    this.topLayerChanged();
    const [, , width, height] = engine.boundingRect(id);
    const left = Math.max(0, Math.min(x, this.width - width));
    engine.setAttribute(id, "style", `left:${left}px;top:${y + height > this.height ? y - height - 28 : y}px`);
  }

  hideBubble() {
    const { bubble } = this;
    if (bubble === 0) return;
    this.bubble = 0;
    this.topLayerChanged();
    this.doc.engine.remove(bubble);
  }

  // ─────────────── the document ───────────────

  loadHtml(source: string) {
    core.replaceAll(null, this.doc.node);
    const parser = documents.startParser(this.doc);
    parser.ended = true;
    parser.write(source);
    parser.run();
  }

  loadXml(source: string, contentType: string) {
    const { doc } = this;
    core.replaceAll(null, doc.node);
    doc.isHtml = false;
    doc.engine.setState(doc.node.id, 3, true);
    doc.contentType = contentType;
    const parser = documents.startParser(doc);
    parser.startXml(source);
    parser.run();
  }

  reached(milestone: string, time = performance.now()) {
    this.onMilestone?.(milestone, (this.milestones[milestone] = time));
  }

  timing(): $Dom.Timing {
    return (this.timings ??= new (require("internal/desktop/dom/timing").Timing)(this, events.timedTypes));
  }

  delayLoad() {
    this.loadDelays++;
  }

  allowLoad() {
    if (--this.loadDelays > 0 || this.doc.readyState === "complete") return;
    this.queueTask(() => {
      if (this.loadDelays > 0 || this.doc.readyState === "complete") return;
      if (this.surface !== 0 && !this.isDisposed) {
        updateRendering(this);
        loader.takeRequests(this);
        if (this.loadDelays > 0) return;
      }
      this.doc.engine.controlSmil(0, 9, performance.now());
      this.doc.engine.controlSmil(0, 0, 0);
      for (const node of core.filterDescendants(this.doc.node, awaitsSvgLoad)) events.fire(node, "load");
      if (this.host.restoresScroll?.()) this.history().restoreScroll(this);
      else if (this.doc.url.includes("#") || this.host.textDirectives) this.scrollToFragment(!this.host.loadsAtTop);
      this.reached("domComplete");
      documents.setReadyState(this.doc, "complete");
      this.reached("loadEventStart");
      events.dispatchToWindowForDocument(this, new events.Event("load"));
      this.reached("loadEventEnd");
      this.container?.fit(this.sizesContainer);
      events.dispatchToWindowForDocument(
        this,
        new events.PageTransitionEvent("pageshow", { bubbles: true, cancelable: true }),
      );
      this.isCompletelyLoaded = true;
      this.fonts?.settle();
      this.host.loaded?.("load");
      if (this.same.$has("refresh")) this.same.$get("refresh")();
      else if (this.host.refresh) this.history().refresh(this, this.host.refresh, false);
    });
  }

  titleChanged() {
    const title = documents.titleOf(this.doc);
    if (title !== this.title) this.host.titleChanged?.((this.title = title));
  }

  faviconChanged() {
    const isIcon = (node: N) => isHtml(node, "link") && /(?:^|\s)icon(?:\s|$)/i.test(getAttr(node, "rel") ?? "");
    const icons = core.filterDescendants(this.doc.node, isIcon);
    this.host.faviconChanged?.(icons.map(node => core.resolveUrl(this.doc, getAttr(node, "href") ?? "")));
  }

  metaChanged(node: N) {
    const content = getAttr(node, "content");
    const name = asciiLower(getAttr(node, "name") ?? "");
    if (name === "color-scheme" || this.hasColorScheme) this.updateColorScheme();
    if (content === null || !(node.flags & core.flags.CONNECTED)) return;
    if (name === "theme-color") {
      if (this.doc.engine.matchMedia(getAttr(node, "media") ?? "")) this.host.themeColorChanged?.(content);
    } else if (name === "responsive-embedded-sizing") {
      if (this.container === null || core.bodyOf(this.doc) !== null || !content.startsWith("allow-origins=")) return;
      const policy = new (require("internal/desktop/web/csp").ContentSecurityPolicy)(this.doc.url);
      this.sizesContainer ||= policy.listsOrigin(
        core.splitTokens(content.slice(14)),
        this.container.page.window.origin,
      );
    } else if (name === "referrer") {
      const legacy = { never: "no-referrer", always: "unsafe-url", default: "strict-origin-when-cross-origin" };
      const value = asciiLower(content).replace("crossorigin", "cross-origin");
      this.host.referrerPolicyChanged?.(Object.hasOwn(legacy, value) ? legacy[value] : value);
    }
    const pragma = asciiLower(getAttr(node, "http-equiv") ?? "");
    if (pragma === "content-security-policy") {
      if (isHtml(node.parent, "head")) this.host.contentSecurityPolicy?.(content);
    } else if (pragma === "default-style") loader.preferSheets(this, content);
    else if (pragma === "content-language" && !content.includes(",")) {
      const [language] = core.splitTokens(content);
      if (language !== undefined) this.setLanguage(language);
    } else if (pragma === "refresh") this.history().refresh(this, content, true);
  }

  updateColorScheme() {
    const { doc } = this;
    const applies = (node: N) =>
      isHtml(node, "meta") &&
      asciiLower(getAttr(node, "name") ?? "") === "color-scheme" &&
      doc.engine.setColorScheme(getAttr(node, "content") ?? "");
    this.hasColorScheme = core.findDescendant(doc.node, applies) !== null;
    if (!this.hasColorScheme) doc.engine.setColorScheme("normal");
    invalidate(doc);
  }

  setLanguage(language: string) {
    this.doc.engine.setLanguage(language);
    invalidate(this.doc);
  }

  indicatedElement(fragment: string): N | null {
    const { doc } = this;
    const find = (name: string) =>
      core.elementById(doc.node, name) ??
      core.findDescendant(doc.node, node => isHtml(node, "a") && getAttr(node, "name") === name);
    let found = find(fragment);
    try {
      found ??= find(decodeURIComponent(fragment));
    } catch {}
    return found;
  }

  setTarget(node: N | null) {
    const old = this.same.$get("target");
    if (old) core.setState(old, states.TARGET, false);
    this.same.$set("target", node);
    if (node !== null) core.setState(node, states.TARGET, true);
  }

  scrollToFragment(scrolls = true) {
    const { doc } = this;
    const { textDirectives } = this.host;
    if (textDirectives && require("internal/desktop/dom/text_fragment").show(this, textDirectives, scrolls))
      return true;
    const fragment = new URL(doc.url).hash.slice(1);
    const found = fragment === "" ? null : this.indicatedElement(fragment);
    if (core.documentElement(doc)?.ns === core.SVG) doc.engine.showFragment();
    this.setTarget(found);
    if (found === null) {
      if (fragment !== "" && asciiLower(fragment) !== "top") return false;
      html.scroll(doc, 1, 0, 0, false);
      return true;
    }
    interactive.reveal(found);
    if (scrolls) html.scrollIntoView(found, 0, 3);
    if (focusing.isFocusable(found)) focusing.focus(found, focusing.SCRIPT, { preventScroll: true });
    else focusing.startTabbingAt(this, found);
    return true;
  }

  followLink(node: N, href: string, event: any) {
    const url = core.resolveUrl(this.doc, href);
    if (url === null) return;
    const opensWindow =
      event.isTrusted && (event.shiftKey || (process.platform === "darwin" ? event.metaKey : event.ctrlKey));
    const base = core.findDescendant(this.doc.node, it => isHtml(it, "base") && core.hasAttr(it, "target"));
    const target = opensWindow ? "_blank" : (getAttr(node, "target") ?? (base && getAttr(base, "target")) ?? "");
    const rel = core.splitTokens(asciiLower(getAttr(node, "rel") ?? ""));
    const referrerPolicy = rel.includes("noreferrer") ? "no-referrer" : core.wrap(node).referrerPolicy;
    const noopener =
      rel.includes("noreferrer") || rel.includes("noopener") || (rel.includes("opener") ? false : undefined);
    for (const ping of core.splitTokens(getAttr(node, "ping"))) this.host.ping?.(core.resolveUrl(this.doc, ping), url);
    const download = getAttr(node, "download") ?? undefined;
    this.navigate(
      url,
      { source: "link", element: node, isByUser: event.isTrusted, download, noopener, referrerPolicy },
      target,
    );
  }

  hasActivation() {
    return performance.now() - this.activatedAt < 5000;
  }

  history() {
    const history = require("internal/desktop/dom/history");
    if (this.entries.length === 0) history.initialize(this);
    return history;
  }

  navigate(url: string, options: object, target = "") {
    this.history().navigate(this, url, options, target);
  }

  traverse(delta: number) {
    this.history().traverse(this, delta);
  }

  frameMarginsChanged() {
    const body = core.bodyOf(this.doc);
    if (body !== null) core.hooks.takeFrameMargins(body);
  }

  createBlankFrame(element: N) {
    const { native, fontScope, reportError, fetchResource, compileHandler, allowsInline, messaging } = this.host;
    const frame = this.createPage({
      native,
      fontScope,
      reportError,
      fetchResource,
      compileHandler,
      allowsInline,
      messaging,
      tasks: this.tasks,
      runsScripts: false,
    });
    const page: Page = frame.window.$impl.x;
    page.frameElement = element;
    page.doc.baseUrl = page.doc.fallbackBaseUrl = this.doc.baseUrl;
    page.host.print = async (...given: unknown[]) => {
      const sandbox = core.getAttr(element, "sandbox");
      if (sandbox === null || core.splitTokens(core.asciiLower(sandbox)).includes("allow-modals"))
        await this.host.print?.(...given);
    };
    require("internal/desktop/dom/parser").parseDocument(page.doc, "");
    return frame;
  }

  dispose() {
    if (this.isDisposed) return;
    if (this.entries.length > 0 || this.hasPainted) this.history().rememberScroll(this);
    if (this.host.isClosed?.()) this.history().abortNavigation(this, true);
    this.isUnloading = true;
    events.dispatchToWindowForDocument(
      this,
      new events.PageTransitionEvent("pagehide", { bubbles: true, cancelable: true }),
    );
    if (this.isVisible) {
      this.isVisible = false;
      if (
        events.hasListeners(this.doc.node, "visibilitychange") ||
        events.hasListeners(this.target, "visibilitychange")
      )
        events.fire(this.doc.node, "visibilitychange", true);
    }
    if (events.hasListeners(this.target, "unload"))
      events.dispatchToWindowForDocument(this, new events.Event("unload"));
    input.cancelGestures(this);
    loader.dispose(this);
    clearTimeout(this.frameTimer);
    clearTimeout(this.wakeTimer);
    clearTimeout(this.accessibilityTimer);
    clearTimeout(this.spelling?.timer);
    this.isDisposed = true;
    core.realm.pages.$delete(this);
    this.doc.container = null;
  }
}

function fireSelectionEvents(page: Page) {
  const targets = Array.from(page.changedSelections);
  page.changedSelections.clear();
  for (const target of targets) {
    const control = textControl(target);
    if (target.scope === page.doc.node || target.scope === null)
      events.fire(target, "selectionchange", control !== null);
    else if (!targets.includes(page.doc.node)) events.fire(page.doc.node, "selectionchange");
    if (control === null) continue;
    const isDue = control.hasSetSelection || control.start !== control.end;
    control.hasSetSelection = false;
    if (isDue) events.fire(target, "select", true);
  }
}

function reportMediaQueries(page: Page) {
  for (const [list, matched] of page.watchedQueries) {
    const { media, matches } = list;
    if (list.$impl.listeners === null) page.watchedQueries.$delete(list);
    else if (matches !== matched) {
      page.watchedQueries.$set(list, matches);
      events.dispatch(list.$impl, new events.MediaQueryListEvent("change", { media, matches }));
    }
  }
}

function runFrameCallbacks(page: Page, time: number) {
  const callbacks = page.frameCallbacks;
  const limit = page.nextCallback;
  for (const [id, callback] of callbacks) {
    if (id >= limit) break;
    callbacks.$delete(id);
    events.callBack(page, callback, page.window, time);
  }
}

function runEarlyCallbacks(page: Page, time: number) {
  for (const id of page.earlyCallbacks.splice(0)) {
    const callback = page.frameCallbacks.$get(id);
    if (page.frameCallbacks.$delete(id)) events.callBack(page, callback!, page.window, time);
  }
}

function sendSelection(doc: Doc) {
  const { engine, selection } = doc;
  const page = doc.page!;
  const r = selection === null ? null : selection.span;
  if (r === null || r.startNode.scope === null || editing.isInIdleControl(r.startNode))
    engine.setSelection(0, 0, 0, 0, 0);
  else {
    const hasCaret = r.collapsed && page.isFocused && editing.typingTarget(doc) !== null;
    const { startNode, startOffset, endNode, endOffset } = r;
    engine.setSelection(
      ranges.pointId(startNode),
      ranges.pointOffset(startNode, startOffset),
      ranges.pointId(endNode),
      ranges.pointOffset(endNode, endOffset),
      hasCaret ? (selection!.upstream ? 2 : 1) : 0,
    );
  }
}
core.hooks.sendSelection = sendSelection;

const spelling = () => require("internal/desktop/dom/spelling");

function showSelection(page: Page) {
  const { doc, composition } = page;
  const { engine, selection } = doc;
  sendSelection(doc);
  cssom.flushHighlights(page);
  if (page.spelling !== null) spelling().beforeFrame(page);
  if (selection === null || page.focusedFrame !== null) return;
  if (!editing.updateInputMethod(page)) return;
  if (page.host.checksSpelling !== undefined) {
    page.spelling ??= new (spelling().Spelling)();
    spelling().caretOrTextChanged(page);
  }
  const id = composition?.node?.id ?? 0;
  engine.setHighlight("", 0, id === 0 ? [] : [id, composition!.start, id, composition!.start + composition!.length]);
}

function awaitsSvgLoad(node: N): boolean {
  return node.ns === core.SVG && node.name === "svg" && events.hasListeners(node, "load");
}

function updateBackground(page: Page) {
  const root = core.documentElement(page.doc);
  if (root === null || (page.environment.transparent && page.container === null)) return;
  const isDark = page.doc.engine.styleBits(root.id, DARK) !== 0;
  let background = isDark ? DARK_CANVAS : 0;
  if (page.container !== null)
    background = isDark === !!(page.container.colorScheme() & DARK) ? 0 : background || 0xffffffff;
  if (background === page.background) return;
  page.native.send("surface.set", { id: page.surface, canvas: (page.background = background) });
}

function updateAccessibility(page: Page) {
  page.accessibilityTimer = null;
  if (page.isAccessible) require("internal/desktop/dom/a11y").update(page);
}

function reportPaint(page: Page, hasMoved: boolean) {
  const { timings } = page;
  if (timings !== null && timings.dispatched.length > 0) timings.presented();
  const isWatched = timings !== null && timings.watchesContent;
  if (page.hasPaintedContent && !(isWatched && (hasMoved || timings.hasNewImages))) return;
  if (page.hasPaintedContent && !timings!.watchesLargest) return timings!.paintedTimedElements();
  const found = page.doc.engine.contentful(1);
  const time = performance.now();
  if (!page.hasPaintedContent && found.some((id, i) => i % 8 === 0 && !page.frames.$has(page.doc.nodes[id]!))) {
    page.hasPaintedContent = true;
    page.reached("first-contentful-paint", time);
  }
  if (isWatched) timings.painted(found, time);
}

/** https://html.spec.whatwg.org/#update-the-rendering */
const EARLY_PAINT_AFTER = 4;
const EARLY_PAINT_UNTIL = 500;

function updateRendering(page: Page) {
  const { doc } = page;
  const { engine } = doc;
  page.frameTimer = null;
  if (page.isInFrame || page.isDisposed) return;
  if (page.suppressesRendering || (!page.hasPainted && loader.isRenderBlocked(page)))
    return void (doc.scheduled = false);
  const time = (page.frameTime = performance.now());
  page.tasks.beginsFrame(page);
  page.isInFrame = doc.scheduled = true;
  page.needsAnotherFrame = false;
  try {
    sync(doc).setTime(time);
    if (!page.isRevealed) {
      page.isRevealed = true;
      if (events.hasListeners(page.target, "pagereveal"))
        events.dispatch(page.target, new events.PageRevealEvent("pagereveal"));
    }
    const lists = doc.cachedLists;
    if (lists.length > 0) doc.cachedLists = lists.filter(forget => !forget(lists.length > 256));
    if (page.earlyCallbacks.length > 0) runEarlyCallbacks(page, time);
    if (page.autofocusCandidates.length > 0) focusing.autofocus(page);
    if (page.wasResized) {
      page.wasResized = false;
      page.openPicker?.close();
      events.fire(page.target, "resize");
      const viewport = page.same.$get("visualViewport");
      if (viewport !== undefined) events.fire(viewport.$impl, "resize");
    }
    if (page.beforeFrame.length > 0) page.runBeforeFrame();
    input.autoscroll(page);
    if (page.environmentChanged) {
      page.environmentChanged = false;
      if (page.responsiveImages.length > 0) loader.reselectImages(page);
      reportMediaQueries(page);
    }
    animation.dispatchEvents(page);
    if (page.fullscreenEvents !== null) interactive.fireFullscreenEvents(page);
    if (page.frameCallbacks.size > 0) runFrameCallbacks(page, time);

    let version = sync(doc).updateLayout();
    if (page.hasNewObservations || (version !== page.layoutVersion && engine.sizesVersion() !== page.sizesVersion)) {
      let depth = 0;
      while ((depth = observers.deliverResizes(page, depth)) !== Infinity) {
        if (depth < 0) {
          page.needsAnotherFrame = true;
          const message = "ResizeObserver loop completed with undelivered notifications.";
          events.dispatchFromScript(page.target, new events.ErrorEvent("error", { message, cancelable: true }), true);
          break;
        }
        sync(doc).updateLayout();
      }
      page.sizesVersion = engine.sizesVersion();
    }
    if (doc.focused !== null) focusing.fixUpFocus(doc);
    loader.takeRequests(page);
    version = sync(doc).updateLayout();
    const hasMoved = version !== page.layoutVersion;
    if (hasMoved || page.hasNewObservations || page.watched.hasSvgTargets) observers.updateIntersections(page, time);
    page.hasNewObservations = page.needsAnotherFrame;
    page.layoutVersion = version;
    if (page.lazyImages.size > 0) loader.loadLazyImages(page);
    if (hasMoved && page.autoSizedImages.size > 0) loader.reselectAutoSizedImages(page);
    if (hasMoved && page.plugins.size > 0) loader.updateRenderedPlugins(page);
    if (page.isDisposed) return;
    if (page.surface !== 0) {
      if (hasMoved) loader.placeFrames(page);
      if (page.hasDirtyFrames) loader.renderFrames(page);
      if (page.isDisposed) return;
      showSelection(page);
      updateBackground(page);
      if (page.transition !== null) {
        page.transition.perform(page.environment.transparent ? 0 : page.background || 0xffffffff);
        page.needsAnotherFrame = true;
      }
      engine.paint(page.surface);
      page.unpaintedSince = performance.now();
      loader.takeRequests(page);
      page.container?.painted(page.surfaceScale);
      if (page.isAccessible) page.accessibilityTimer ??= setTimeout(updateAccessibility, ACCESSIBILITY_DELAY, page);
    }
    if (engine.isBroken()) return page.host.crashed?.();
    animation.takeEvents(page);
    doc.scheduled = false;
    const hasWork =
      page.needsAnotherFrame || page.hasDirtyFrames || page.frameCallbacks.size > 0 || page.engineEvents.length > 0;
    clearTimeout(page.wakeTimer);
    if (hasWork || engine.pending() & 8 || engine.isAnimating()) invalidate(doc);
    else {
      const delay = engine.nextWake(events.isListenedTo("animationiteration"));
      if (delay !== Infinity) page.wakeTimer = setTimeout(invalidate, delay + 1, doc).unref();
    }
    if (!hasWork) page.frameTimer?.unref();
    if (!page.hasPainted && core.bodyOf(doc) !== null) {
      page.hasPainted = true;
      page.reached("first-paint");
      page.host.firstPaint?.();
    }
    if (page.hasPainted) reportPaint(page, hasMoved);
    input.afterPaint(page, hasMoved);
  } finally {
    page.isInFrame = false;
  }
}

function setFocused(page: Page, isFocused: boolean) {
  if (page.isFocused === isFocused) return;
  page.isFocused = isFocused;
  if (page.container !== null) page.inputMethodState.forget();
  if (!isFocused) input.cancelGestures(page);
  page.readEnvironment();
  focusing.windowFocusChanged(page);
}

function handleEvent(page: Page, event: any) {
  routeEvent(page, event);
  if (page.timings !== null && page.timings.dispatched.length > 0 && !page.doc.scheduled) page.timings.presented();
}

function routeEvent(page: Page, event: any) {
  if (page.hasRemoteFrames && require("internal/desktop/dom/remote_frame").route(page, event)) return;
  switch (event.t) {
    case "frame":
      if (!page.doc.scheduled) return;
      if (!event.isUrgent && page.tasks.canFrameWait()) page.native.requestFrame(page.surface);
      else updateRendering(page);
      return;
    case "mouse":
      if (event.e !== "move") page.gotInput();
      input.handleMouse(page, event);
      if (event.e === "move") return;
      page.hadInput ||= event.e === "down";
      page.tasks.hurry();
      page.renderNow();
      return;
    case "pen":
      require("internal/desktop/dom/touch").handlePen(page, event);
      break;
    case "touch":
      page.hadInput = true;
      require("internal/desktop/dom/touch").handleTouch(page, event);
      break;
    case "wheel":
    case "pinch":
      page.hadInput = true;
      page.tasks.scrolls();
      return input.handleWheel(page, event);
    case "scroll":
      page.tasks.scrolls();
      page.mouse.scrolledAt = performance.now();
      page.doc.engine.scrolledByCompositor(event.id, event.x, event.y, event.hasEnded, event.generation);
      return invalidate(page.doc);
    case "key":
      page.hadInput = true;
      page.gotInput();
      input.handleKey(page, event);
      page.tasks.hurry();
      if (page.pressedKey === null) page.renderNow();
      return;
    case "text":
      input.handleText(page, event);
      break;
    case "compose":
      editing.compose(page, event.text, event.selection, event.range);
      break;
    case "composeEnd":
      editing.endComposition(page);
      break;
    case "resize":
      page.resize(event.width, event.height, event.scale);
      if (event.isQuiet) return;
      page.tasks.hurry(false);
      break;
    case "focus":
    case "blur":
      return setFocused(page, event.t === "focus");
    case "drag":
      return input.handleFileDrag(page, event);
    case "a11y":
      page.isAccessible = event.active;
      return updateAccessibility(page);
    case "a11yAction":
      return require("internal/desktop/dom/a11y").perform(page, event);
  }
  page.renderNow();
}

export default { Page };
