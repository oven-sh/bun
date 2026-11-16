// Browsing contexts: which documents share their objects, and what they see of the others.
const native = require("internal/desktop/native");
const policy = require("internal/desktop/electron/policy");
const { queueTask } = require("internal/desktop/electron/stubs");

/** The documents of a group that have the same origin. They use the `dom/` modules of the first one. */
class Agent {
  root: any;
  pages = new Set<object>();

  constructor(
    readonly group: Map<unknown, Agent>,
    readonly key: unknown,
  ) {}

  leave(page: object) {
    this.pages.$delete(page);
    if (this.pages.$size > 0) return;
    this.group.$delete(this.key);
    this.root.release();
  }
}

/** A window or a frame, whatever document it has. */
class Context {
  name = "";
  isClosed = false;
  isPopup = false;
  page: any;
  opener: Context | null = null;
  group = new Map<unknown, Agent>();
  members = new Set<Context>([this]);
  #windows = new Map<Agent, object>();

  constructor(
    readonly state: any,
    readonly parent: Context | null,
    related: Context | null,
  ) {
    if (related === null) return;
    this.group = related.group;
    this.members = related.members.$add(this);
  }

  get top(): Context {
    return this.parent?.top ?? this;
  }

  /** In the order of the tree. */
  children(): Context[] {
    return this.page.controller?.frames() ?? [];
  }

  join(page: any): [Agent, object | undefined] {
    let agent = this.group.$get(page.originKey);
    if (agent === undefined) this.group.$set(page.originKey, (agent = new Agent(this.group, page.originKey)));
    agent.pages.$add(page);
    return [agent, this.#windows.$get(agent)];
  }

  joined(agent: Agent, world: any) {
    agent.root ??= world;
    this.#windows.$set(agent, world.global);
  }

  /** What was the window of the last document is now one of another origin. */
  committed(page: any) {
    if (
      this.parent === null &&
      this.opener === null &&
      this.page?.isInitial === false &&
      this.page.originKey !== page.originKey
    )
      this.name = "";
    this.page = page;
    for (const [agent, window] of this.#windows) {
      if (agent.pages.$size === 0) this.#windows.$delete(agent);
      else if (agent.key !== page.originKey) agent.root.controller.crossOriginWindow(this.#asSeenBy(agent), window);
    }
  }

  windowFor(agent: Agent): object {
    if (this.page.originKey === agent.key && !this.isClosed) this.state.page();
    let window = this.#windows.$get(agent);
    if (window === undefined)
      this.#windows.$set(agent, (window = agent.root.controller.crossOriginWindow(this.#asSeenBy(agent)))!);
    return window!;
  }

  #asSeenBy(agent: Agent) {
    const windowOf = (context: Context | null) => (context && !this.isClosed ? context.windowFor(agent) : null);
    return {
      isClosed: () => this.isClosed,
      length: () => this.children().length,
      child: (key: number | string) => {
        const all = this.children();
        return (typeof key === "number" ? all[key] : all.find(it => it.name === key))?.windowFor(agent);
      },
      parent: () => windowOf(this.parent ?? this),
      top: () => windowOf(this.top),
      opener: () => windowOf(this.opener),
      navigate: (source: any, url: string, replace: boolean) => this.navigate(source, url, { replace }),
      postMessage: (source: any, message: unknown, origin: string, transfer: object[]) =>
        this.state.page().postMessage(source, message, origin, transfer),
      close: () => this.close(),
      focus: () => this.state.focus(),
    };
  }

  /** https://html.spec.whatwg.org/#allowed-to-navigate */
  isNavigableBy(source: any) {
    const { sandbox, context } = source;
    if (sandbox === undefined || context === this) return true;
    for (let it = this.parent; it !== null; it = it.parent) if (it === context) return true;
    if (this.parent !== null) return false;
    if (this !== context.top) return this.opener === context;
    return (
      sandbox.has("allow-top-navigation") ||
      (sandbox.has("allow-top-navigation-by-user-activation") && source.controller.isActive())
    );
  }

  /** Browsers are stricter than the standard. */
  #isWithinReachOf(source: any, url: string) {
    const isOrIsInSameOrigin = (context: Context | null) => {
      for (let it = context; it !== null; it = it.parent) if (it.page.originKey === source.originKey) return true;
    };
    if (isOrIsInSameOrigin(this)) return true;
    if (this.parent !== null) return false;
    if (this !== source.context.top)
      return this === source.context.opener || this.opener === null || isOrIsInSameOrigin(this.opener);
    return source.sandbox !== undefined || source.controller.hasBeenActive() || policy.isSameSite(url, this.page.url);
  }

  navigate(source: any, url: string, options: any) {
    if (!this.isNavigableBy(source) || !this.#isWithinReachOf(source, url)) return false;
    if (this.page.originKey === source.originKey && this.page.controller)
      this.page.controller.navigate(url, options, source);
    else if (
      url.includes("#") &&
      url.split("#")[0] === this.page.url.split("#")[0] &&
      options.body === undefined &&
      this.page.controller
    ) {
      this.page.controller.navigate(url, { replace: options.replace, isByUser: options.isByUser }, source);
    } else this.state.navigate(url, options, source);
    return true;
  }

  close() {
    if (this.parent !== null || this.isClosed) return;
    this.isClosed = true;
    queueTask(() =>
      this.state.type === "window" && this.state.window() ? this.state.window().close() : this.state.close(),
    );
  }

  discard() {
    this.isClosed = true;
    this.members.$delete(this);
  }

  #findBelow(name: string): Context | undefined {
    if (this.name === name) return this;
    for (const child of this.children()) {
      const found = child.#findBelow(name);
      if (found !== undefined) return found;
    }
  }

  #isFamiliarTo(other: Context): boolean {
    for (let it: Context | null = this; it !== null; it = it.parent)
      if (it.page.originKey === other.page.originKey) return true;
    if (this === other.top) return true;
    return this.parent === null && this.opener !== null && this.opener.#isFamiliarTo(other);
  }

  /** Undefined for a new window. */
  choose(target: string): Context | undefined {
    const keyword = target.toLowerCase();
    if (keyword === "" || keyword === "_self") return this;
    if (keyword === "_parent") return this.parent ?? this;
    if (keyword === "_top") return this.top;
    if (keyword === "_blank") return;
    for (let it: Context | null = this; it !== null; it = it.parent) {
      const found = it.#findBelow(target);
      if (found !== undefined) return found;
    }
    for (const it of this.members) if (it.name === target && !it.isClosed && it.#isFamiliarTo(this)) return it;
  }
}

/** What an `<iframe>`, `<frame>`, `<object>` or `<embed>` has of its document in this process. */
class LocalFrame {
  element: any;
  context: Context;
  image: number = native.ask("webview.open", {});
  #state: any;
  #parent: any;
  #size = "";

  constructor(parent: any, element: any, createContents: (frame: LocalFrame) => any) {
    this.#parent = parent;
    this.element = element;
    this.#state = createContents(this);
    this.context = this.#state.context;
    parent.frames.$add(this);
    this.#tellObservers();
  }

  #tellObservers() {
    this.#parent.context.state.observers.forEach(it => it.framesChanged?.());
  }

  /** For `WebFrameMain`. */
  get frames() {
    return this.context.page.handle.framesInSubtree;
  }

  window() {
    return this.context.windowFor(this.#parent.agent);
  }

  document() {
    return this.context.page.originKey === this.#parent.originKey ? this.#state.page().controller.document : null;
  }

  navigate(url: string, srcdoc: string | undefined, referrerPolicy: string) {
    const { isInitial, isLoaded, originKey } = this.context.page;
    const options = { replace: isInitial || !isLoaded, srcdoc, referrerPolicy };
    if (url.startsWith("javascript:")) {
      if (originKey !== this.#parent.originKey) return void (isInitial && this.element.loaded(true));
      this.element.loading();
      this.#state.page().controller.navigate(url, { noDocument: () => this.element.loaded(isInitial) }, this.#parent);
    } else if (isInitial) this.#state.navigate(url, options, this.#parent);
    else this.context.navigate(this.#parent, url, options);
  }

  place(width: number, height: number, scale: number, isVisible: boolean) {
    const size = `${width},${height},${scale},${isVisible}`;
    if (size === this.#size) return;
    this.#size = size;
    this.#state.isShown = isVisible;
    native.send("surface.set", { id: this.#state.surface, bounds: { x: 0, y: 0, width, height } });
    this.#state.input({ t: "resize", width, height, scale, isQuiet: true });
  }

  page() {
    return this.context.page.controller?.page;
  }

  render() {
    this.context.page.controller?.render();
  }

  /** `rect`: what a frame in it has changed, outside of a rendering of the page. */
  painted(scale: number, rect?: object) {
    if (!this.#state.isShown) return;
    native.send("webview.mirror", { id: this.image, scale, surface: this.#state.surface, rect });
    if (rect) this.#parent.context.state.container?.painted(scale, {});
  }

  input(event: object) {
    this.#state.input(event);
  }

  edit(name: string) {
    return this.context.page.controller?.edit(name);
  }

  beforeUnload() {
    return this.context.page.controller?.beforeUnload() !== false;
  }

  environmentChanged() {
    this.#state.environmentChanged();
  }

  activate() {
    if (this.context.page.originKey === this.#parent.originKey) this.context.page.controller?.activate();
  }

  dispose() {
    this.#parent.frames.$delete(this);
    this.#state.destroy();
    this.#tellObservers();
    native.send("webview.close", { id: this.image });
  }
}

export default { Context, LocalFrame };
