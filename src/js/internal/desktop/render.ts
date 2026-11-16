// Components and hooks. Elements have the shape that React's have, so what `Bun.markdown.react()` makes renders too.
const native = require("internal/desktop/native");

let core: $BunModules["internal/desktop/dom/core"];
let dom: $BunModules["internal/desktop/props"];

const KIND = "$$typeof";
const ELEMENT = Symbol.for("react.transitional.element");
const LEGACY_ELEMENT = Symbol.for("react.element");
const Fragment = Symbol.for("react.fragment");
const StrictMode = Symbol.for("react.strict_mode");
const Suspense = Symbol.for("react.suspense");
const MEMO = Symbol.for("react.memo");
const FORWARD_REF = Symbol.for("react.forward_ref");
const CONTEXT = Symbol.for("react.context");
const PORTAL = Symbol.for("react.portal");
const TEXT = Symbol("text");

type Props = Record<string, any>;
type VNode = { [KIND]: symbol; type: any; key: string | null; props: Props };
type Effect = { create: () => any; cleanup?: () => void; deps?: unknown[]; due: boolean; layout: boolean };

function jsx(type: any, props: Props, key?: unknown): VNode {
  if ("key" in props) ({ key, ...props } = props);
  return { [KIND]: ELEMENT, type, key: key == null ? null : String(key), props };
}

function createElement(type: any, props?: Props | null, ...children: unknown[]): VNode {
  props = { ...props };
  if (children.length > 0) props.children = children.length === 1 ? children[0] : children;
  return jsx(type, props);
}

function isValidElement(value: any): value is VNode {
  return value?.[KIND] === ELEMENT || value?.[KIND] === LEGACY_ELEMENT;
}

function cloneElement(element: VNode, props?: Props | null, ...children: unknown[]): VNode {
  return createElement(element.type, { key: element.key, ...element.props, ...props }, ...children);
}

class Fiber {
  type: any;
  key: string | number;
  props: Props;
  parent: Fiber | null;
  depth: number;
  children: Fiber[] = [];
  /** Of a host element or a text. For a portal or a root, the container, which it does not own. */
  node: any = null;
  handlers: Map<string, any> | null = null;
  isNew = true;
  hooks: any[] = [];
  effects: Effect[] | null = null;
  instance: Component | null = null;
  /** The contexts it has read. */
  providers: Set<Fiber> | null = null;
  /** Of a context provider. */
  consumers: Set<Fiber> | null = null;
  ref: any = null;
  releaseRef: (() => void) | null = null;
  /** Of a <Suspense> that waits. `children` keep their state meanwhile. */
  fallback: Fiber | null = null;
  postponed: Fiber[] | null = null;
  dirty = false;
  /** False from the start of a render to its end, and after one that threw. */
  complete = false;
  misplaced = false;
  unmounted = false;

  constructor(type: any, key: string | number, props: Props, parent: Fiber | null) {
    this.type = type;
    this.key = key;
    this.props = props;
    this.parent = parent;
    this.depth = parent ? parent.depth + 1 : 0;
  }
}

let current: Fiber | null = null;
let hookIndex = 0;
let queue: Fiber[] = [];
let flushQueued = false;
let flushing = false;
let misplaced: Fiber[] = [];
let committed: Fiber[] = [];
let passive: Fiber[] = [];
let nextId = 0;

function schedule(fiber: Fiber) {
  if (fiber.dirty || fiber.unmounted) return;
  fiber.dirty = true;
  queue.push(fiber);
  if (!flushQueued) {
    flushQueued = true;
    queueMicrotask(flush);
  }
}

function flush() {
  flushQueued = false;
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    for (let pass = 0; queue.length > 0; pass++) {
      if (pass === 100) {
        for (const fiber of queue) fiber.dirty = false;
        queue = [];
        throw new Error("Too many re-renders. A component sets its state in each render or layout effect.");
      }
      runPassiveEffects();
      const batch = queue.sort((a, b) => a.depth - b.depth);
      queue = [];
      for (const fiber of batch) {
        if (!fiber.dirty || fiber.unmounted) continue;
        try {
          update(fiber, fiber.props);
        } catch (error) {
          recover(fiber, error);
        }
      }
      // Context consumers below a memoized component. They belong to the same commit.
      if (!queue.some(fiber => fiber.dirty)) commit();
    }
  } finally {
    flushing = false;
  }
}

function flushSync<T>(callback?: () => T): T | undefined {
  try {
    return callback?.();
  } finally {
    flush();
  }
}

function commit() {
  const parents = misplaced;
  misplaced = [];
  for (const parent of parents) {
    parent.misplaced = false;
    if (!parent.unmounted) fill(parent.node);
  }
  const fibers = committed;
  committed = [];
  for (const fiber of fibers) {
    if (!fiber.node || fiber.unmounted) continue;
    dom.setValue(fiber.node, fiber.props, fiber.isNew);
    if (fiber.isNew && fiber.props.autoFocus) core.wrap(fiber.node).focus();
    fiber.isNew = false;
    if (fiber.ref !== (fiber.props.ref ?? null)) attachRef(fiber, core.wrap(fiber.node));
  }
  const hadPassive = passive.length > 0;
  for (const fiber of fibers) {
    if (fiber.unmounted || !fiber.effects) continue;
    const waiting = waitingSuspense(fiber);
    if (waiting) {
      waiting.postponed!.push(fiber);
      continue;
    }
    runEffects(fiber, true);
    passive.push(fiber);
  }
  if (!hadPassive && passive.length > 0) setImmediate(runPassiveEffects);
}

function runPassiveEffects() {
  const fibers = passive;
  passive = [];
  for (const fiber of fibers) runEffects(fiber, false);
}

function runEffects(fiber: Fiber, layout: boolean) {
  for (const effect of fiber.effects!) {
    if (!effect.due || effect.layout !== layout || fiber.unmounted) continue;
    effect.due = false;
    try {
      effect.cleanup?.();
      effect.cleanup = undefined;
      const cleanup = effect.create();
      if ($isCallable(cleanup)) effect.cleanup = cleanup;
    } catch (error) {
      recover(fiber, error);
    }
  }
}

function waitingSuspense(fiber: Fiber): Fiber | undefined {
  for (let parent = fiber.parent; parent; fiber = parent, parent = parent.parent) {
    if (parent.fallback && parent.fallback !== fiber) return parent;
  }
}

function setRef(ref: any, value: unknown): () => void {
  if (!$isCallable(ref)) {
    ref.current = value;
    return () => (ref.current = null);
  }
  const cleanup = ref(value);
  return $isCallable(cleanup) ? cleanup : () => ref(null);
}

function attachRef(fiber: Fiber, value: unknown) {
  const ref = fiber.props.ref ?? null;
  if (ref === fiber.ref) return;
  fiber.releaseRef?.();
  fiber.ref = ref;
  fiber.releaseRef = ref && setRef(ref, value);
}

function collect(fiber: Fiber, nodes: unknown[]) {
  for (const child of fiber.fallback ? [fiber.fallback] : fiber.children) {
    if (child.type === PORTAL) continue;
    if (child.node) nodes.push(child.node);
    else collect(child, nodes);
  }
  return nodes;
}

/** An element's fiber, and the portals into it. */
const fillers = new WeakMap<object, Fiber[]>();

const rendered = new WeakSet<object>();
const isRendered = (node: object) => rendered.has(node);

function fill(node: any) {
  const nodes = [];
  for (const fiber of fillers.get(node) ?? []) collect(fiber, nodes);
  dom.replaceChildren(node, nodes, isRendered);
}

function openPortal(portal: Fiber, container: any) {
  core ??= require("internal/desktop/dom/core");
  dom ??= require("internal/desktop/props");
  portal.node = container = core.unwrap(container, "render");
  fillers.set(container, [...(fillers.get(container) ?? []), portal]);
}

function closePortal(portal: Fiber) {
  if (!portal.node) return;
  fillers.set(
    portal.node,
    fillers.get(portal.node)!.filter(fiber => fiber !== portal),
  );
  fill(portal.node);
}

function hostOf(fiber: Fiber): Fiber {
  while (!fiber.node) fiber = fiber.parent!;
  return fiber;
}

function place(fiber: Fiber) {
  const host = hostOf(fiber);
  if (host.misplaced) return;
  host.misplaced = true;
  misplaced.push(host);
}

function unmount(fiber: Fiber) {
  fiber.unmounted = true;
  if (fiber.effects) {
    for (const effect of fiber.effects) {
      try {
        effect.cleanup?.();
      } catch (error) {
        reportError(error);
      }
    }
  }
  fiber.releaseRef?.();
  if (fiber.providers) for (const provider of fiber.providers) provider.consumers!.$delete(fiber);
  for (const child of fiber.children) unmount(child);
  if (fiber.fallback) unmount(fiber.fallback);
  if (fiber.type === PORTAL) closePortal(fiber);
}

function unmountChildren(fiber: Fiber) {
  const { children } = fiber;
  fiber.children = [];
  for (const child of children) unmount(child);
  place(fiber);
}

function reconcile(parent: Fiber, rendered: any) {
  const values: any[] = $isArray(rendered) ? rendered : [rendered];
  const previous = parent.children;
  const next: Fiber[] = [];
  const nextProps: Props[] = [];
  let byKey: Map<string | number, Fiber> | undefined;
  let cursor = 0;

  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value == null || typeof value === "boolean" || value === "") continue;
    let type: any;
    let key: string | number = index;
    let props: Props;
    if (typeof value !== "object") {
      if ($isCallable(value)) throw new TypeError("A function cannot be rendered. Write <Component /> to render one.");
      type = TEXT;
      props = String(value) as any;
    } else if (isValidElement(value)) {
      type = value.type === StrictMode ? Fragment : value.type;
      key = value.key ?? index;
      props = value.props;
      if (value[KIND] === LEGACY_ELEMENT && (value as any).ref) props = { ...props, ref: (value as any).ref };
    } else if (value[Symbol.iterator]) {
      type = Fragment;
      props = { children: $isArray(value) ? value : [...value] };
    } else {
      throw new TypeError(`An object cannot be rendered: ${Bun.inspect(value, { compact: true, depth: 0 })}`);
    }

    let match: Fiber | undefined;
    if (byKey === undefined && cursor < previous.length) {
      if (previous[cursor].key === key && previous[cursor].type === type) match = previous[cursor++];
      else {
        byKey = new Map();
        for (let i = cursor; i < previous.length; i++) {
          if (!byKey.$has(previous[i].key)) byKey.$set(previous[i].key, previous[i]);
        }
      }
    }
    if (byKey !== undefined) {
      match = byKey.$get(key);
      if (match?.type === type) byKey.$delete(key);
      else match = undefined;
    }
    next.push(match ?? new Fiber(type, key, props, parent));
    nextProps.push(props);
  }

  // Before anything can throw, so that `unmount` finds every fiber.
  parent.children = next;
  if (cursor !== previous.length || cursor !== next.length) {
    place(parent);
    const kept = new Set(next);
    for (let i = cursor; i < previous.length; i++) if (!kept.$has(previous[i])) unmount(previous[i]);
  }
  for (let i = 0; i < next.length; i++) {
    const fiber = next[i];
    if (fiber.complete && !fiber.dirty && isUnchanged(fiber, nextProps[i])) continue;
    update(fiber, nextProps[i]);
  }
}

function shallowEqual(a: Props, b: Props) {
  for (const key in a) if (!(key in b)) return false;
  for (const key in b) if (!Object.is(a[key], b[key])) return false;
  return true;
}

function isUnchanged(fiber: Fiber, props: Props) {
  if (fiber.props === props) return true;
  return fiber.type?.[KIND] === MEMO && (fiber.type.compare ?? shallowEqual)(fiber.props, props);
}

function update(fiber: Fiber, props: Props) {
  const { type } = fiber;
  const previous = fiber.props;
  fiber.props = props;
  fiber.dirty = false;
  fiber.complete = false;

  if (type === TEXT) {
    if (fiber.node) core.replaceData(fiber.node, 0, fiber.node.data.length, props as any);
    else rendered.add((fiber.node = core.createText(hostOf(fiber).node.doc, props as any)));
  } else if (typeof type === "string") {
    const isNew = !fiber.node;
    if (isNew) {
      fillers.set((fiber.node = dom.createElement(type, hostOf(fiber).node)), [fiber]);
      rendered.add(fiber.node);
    }
    dom.setProps(fiber.node, (fiber.handlers ??= new Map()), props, isNew ? {} : previous);
    reconcile(fiber, props.children);
    if ((props.ref ?? null) !== fiber.ref || props.autoFocus || fiber.node.x !== null) committed.push(fiber);
  } else if (type === Fragment) {
    reconcile(fiber, props.children);
  } else if (type === PORTAL) {
    if (fiber.node?.js !== props.container) {
      closePortal(fiber);
      openPortal(fiber, props.container);
      place(fiber);
    }
    reconcile(fiber, props.children);
  } else if (type === Suspense) {
    updateSuspense(fiber);
  } else if (type?.[KIND] === CONTEXT) {
    if (fiber.consumers && !Object.is(previous.value, props.value)) for (const each of fiber.consumers) schedule(each);
    reconcile(fiber, props.children);
  } else if (type?.prototype?.isReactComponent) {
    updateClass(fiber, previous);
  } else {
    reconcile(fiber, renderFunction(fiber));
    if (fiber.effects) committed.push(fiber);
  }
  fiber.complete = true;
}

function renderFunction(fiber: Fiber) {
  let { type, props } = fiber;
  if (type?.[KIND] === MEMO) {
    type = type.type;
    if (!$isCallable(type) || type.prototype?.isReactComponent) return jsx(type, props);
  }
  current = fiber;
  hookIndex = 0;
  try {
    if (type?.[KIND] === FORWARD_REF) {
      const { ref = null, ...rest } = props;
      return type.render(rest, ref);
    }
    if (!$isCallable(type)) throw new TypeError(`An element's type is a string or a component, not ${String(type)}`);
    return type(props);
  } finally {
    current = null;
  }
}

const isThenable = (value: any) => $isCallable(value?.then);

function updateSuspense(fiber: Fiber) {
  try {
    reconcile(fiber, fiber.props.children);
  } catch (thrown) {
    if (!isThenable(thrown)) throw thrown;
    return suspend(fiber, thrown);
  }
  if (!fiber.fallback) return;
  unmount(fiber.fallback);
  fiber.fallback = null;
  committed.push(...fiber.postponed!);
  fiber.postponed = null;
  place(fiber);
}

function suspend(fiber: Fiber, thenable: any) {
  const retry = () => schedule(fiber);
  thenable.then(retry, retry);
  fiber.postponed ??= [];
  fiber.fallback ??= new Fiber(Fragment, -1, {}, fiber);
  update(fiber.fallback, { children: fiber.props.fallback });
  place(fiber);
}

const isBoundary = (fiber: Fiber) =>
  fiber.instance !== null && (fiber.type.getDerivedStateFromError || (fiber.instance as any).componentDidCatch);

/** For what is thrown where no `update` of an ancestor is on the stack. */
function recover(fiber: Fiber, thrown: any) {
  for (let child = fiber, parent = fiber.parent; parent; child = parent, parent = parent.parent) {
    try {
      if (isThenable(thrown)) {
        // The way back down, for the retry.
        child.complete = false;
        if (parent.type !== Suspense || parent.fallback === child) continue;
        return suspend(parent, thrown);
      }
      if (!isBoundary(parent)) continue;
      caught(parent, thrown);
      return schedule(parent);
    } catch (error) {
      thrown = error;
    }
  }
  while (fiber.parent) fiber = fiber.parent;
  unmountChildren(fiber);
  reportError(isThenable(thrown) ? new Error("A component suspended outside of a <Suspense>") : thrown);
}

function caught(boundary: Fiber, error: unknown) {
  const instance: any = boundary.instance;
  unmountChildren(boundary);
  const state = boundary.type.getDerivedStateFromError?.(error);
  if (state) instance[kPending].push(state);
  else instance[kFailed] = true;
  instance[kForced] = true;
  instance[kCallbacks].push(() => instance.componentDidCatch?.(error, { componentStack: "" }));
}

const kFiber = Symbol("kFiber");
const kPending = Symbol("kPending");
const kCallbacks = Symbol("kCallbacks");
const kForced = Symbol("kForced");
const kFailed = Symbol("kFailed");

class Component {
  props: Props;
  state: any;
  context: any;
  declare isReactComponent: object;
  [kFiber]: Fiber | undefined;
  [kPending]: any[] = [];
  [kCallbacks]: (() => void)[] = [];
  [kForced] = false;
  /** It caught an error, and has no state yet to render it with. */
  [kFailed] = false;

  constructor(props: Props) {
    this.props = props;
  }

  setState(state: any, callback?: () => void) {
    this[kPending].push(state);
    this[kFailed] = false;
    if (callback) this[kCallbacks].push(callback);
    if (this[kFiber]) schedule(this[kFiber]);
  }

  forceUpdate(callback?: () => void) {
    this[kForced] = true;
    this.setState(null, callback);
  }
}
Component.prototype.isReactComponent = {};

class PureComponent extends Component {
  shouldComponentUpdate(props: Props, state: any) {
    return !shallowEqual(this.props, props) || !shallowEqual(this.state ?? {}, state ?? {});
  }
}

function updateClass(fiber: Fiber, previousProps: Props) {
  const { type, props } = fiber;
  let instance: any = fiber.instance;
  const mounting = instance === null;
  if (mounting) {
    instance = fiber.instance = new type(props);
    instance[kFiber] = fiber;
    const mount = () => {
      instance.componentDidMount?.();
      return () => instance.componentWillUnmount?.();
    };
    fiber.effects = [
      { create: mount, due: true, layout: true },
      { create() {}, due: false, layout: true },
    ];
  }
  const previousState = instance.state;
  const render = () => {
    let state = instance.state;
    for (const pending of instance[kPending].splice(0)) {
      state = { ...state, ...($isCallable(pending) ? pending.$call(instance, state, props) : pending) };
    }
    if (type.getDerivedStateFromProps) state = { ...state, ...type.getDerivedStateFromProps(props, state) };
    const context = type.contextType && readContext(fiber, type.contextType);
    const renders =
      mounting ||
      instance[kForced] ||
      context !== instance.context ||
      fiber.children.some(child => !child.complete) ||
      instance.shouldComponentUpdate?.(props, state, context) !== false;
    instance.props = props;
    instance.state = state;
    instance.context = context;
    instance[kForced] = false;
    return { renders, output: renders && !instance[kFailed] ? instance.render() : null };
  };

  const { renders, output } = render();
  if (renders) {
    try {
      reconcile(fiber, output);
    } catch (error) {
      if (isThenable(error) || !isBoundary(fiber)) throw error;
      caught(fiber, error);
      reconcile(fiber, render().output);
    }
  }
  const updated = fiber.effects![1];
  updated.due = true;
  updated.create = () => {
    attachRef(fiber, instance);
    if (renders && !mounting) instance.componentDidUpdate?.(previousProps, previousState);
    for (const callback of instance[kCallbacks].splice(0)) callback.$call(instance);
  };
  committed.push(fiber);
}

function rendering(): Fiber {
  if (current === null) throw new Error("Hooks can only be called while a function component renders");
  return current;
}

function hook<T>(create: (fiber: Fiber) => T): T {
  const fiber = rendering();
  if (hookIndex === fiber.hooks.length) fiber.hooks.push(create(fiber));
  return fiber.hooks[hookIndex++];
}

function changed(previous: unknown[] | undefined, next: unknown[] | undefined) {
  if (previous === undefined || next === undefined || previous.length !== next.length) return true;
  for (let i = 0; i < next.length; i++) if (!Object.is(previous[i], next[i])) return true;
  return false;
}

function useReducer(reducer: (state: any, action: any) => any, initial: any, init?: (initial: any) => any) {
  const state = hook(fiber => {
    const state = {
      value: init ? init(initial) : initial,
      reducer,
      dispatch(action: any) {
        const value = state.reducer(state.value, action);
        if (Object.is(value, state.value)) return;
        state.value = value;
        schedule(fiber);
      },
    };
    return state;
  });
  state.reducer = reducer;
  return [state.value, state.dispatch];
}

const setOrCall = (state: any, action: any) => ($isCallable(action) ? action(state) : action);
const valueOrCall = (initial: any) => ($isCallable(initial) ? initial() : initial);

function useState(initial?: any) {
  return useReducer(setOrCall, initial, valueOrCall);
}

function effectHook(create: () => any, deps: unknown[] | undefined, layout: boolean) {
  const effect = hook(fiber => {
    const effect: Effect = { create, due: true, layout };
    (fiber.effects ??= []).push(effect);
    return effect;
  });
  if (effect.due || changed(effect.deps, deps)) {
    effect.create = create;
    effect.deps = deps;
    effect.due = true;
  }
}

function useEffect(create: () => any, deps?: unknown[]) {
  effectHook(create, deps, false);
}

function useLayoutEffect(create: () => any, deps?: unknown[]) {
  effectHook(create, deps, true);
}

function useMemo(create: () => any, deps?: unknown[]) {
  const memoized = hook(() => ({ value: undefined as any, deps: undefined as unknown[] | undefined }));
  if (changed(memoized.deps, deps)) {
    memoized.value = create();
    memoized.deps = deps;
  }
  return memoized.value;
}

function useCallback(callback: any, deps?: unknown[]) {
  return useMemo(() => callback, deps);
}

function useRef(initial?: any) {
  return hook(() => ({ current: initial }));
}

function useId() {
  return hook(() => ({ id: `:r${(nextId++).toString(36)}:` })).id;
}

function useImperativeHandle(ref: any, create: () => any, deps?: unknown[]) {
  useLayoutEffect(() => (ref ? setRef(ref, create()) : undefined), deps && [...deps, ref]);
}

function useEffectEvent(callback: (...args: any[]) => any) {
  const latest = hook(() => {
    const latest = { callback, run: (...args: any[]) => latest.callback(...args) };
    return latest;
  });
  latest.callback = callback;
  return latest.run;
}

function useSyncExternalStore(subscribe: (listener: () => void) => () => void, getSnapshot: () => any) {
  const fiber = rendering();
  const value = getSnapshot();
  const store = hook(() => ({ value, getSnapshot }));
  store.value = value;
  store.getSnapshot = getSnapshot;
  useLayoutEffect(() => {
    const check = () => {
      if (!Object.is(store.getSnapshot(), store.value)) schedule(fiber);
    };
    check();
    return subscribe(check);
  }, [subscribe]);
  return value;
}

function startTransition(callback: () => unknown) {
  callback();
}

function useTransition() {
  const [pending, setPending] = useState(0);
  const start = useCallback((callback: () => any) => {
    const result = callback();
    if (!isThenable(result)) return;
    setPending((count: number) => count + 1);
    Promise.$resolve(result).finally(() => setPending((count: number) => count - 1));
  }, []);
  return [pending > 0, start];
}

function useDeferredValue(value: any) {
  const [deferred, setDeferred] = useState(() => value);
  useEffect(() => setDeferred(() => value), [value]);
  return deferred;
}

function createContext(defaultValue: any) {
  const context: any = { [KIND]: CONTEXT, defaultValue };
  context.Provider = context;
  context.Consumer = ({ children }: Props) => children(useContext(context));
  return context;
}

function readContext(fiber: Fiber, context: any) {
  let provider = fiber.parent;
  while (provider && provider.type !== context) provider = provider.parent;
  if (!provider) return context.defaultValue;
  (provider.consumers ??= new Set()).$add(fiber);
  (fiber.providers ??= new Set()).$add(provider);
  return provider.props.value;
}

function useContext(context: any) {
  return readContext(rendering(), context);
}

const settled = new WeakMap<object, { value: unknown } | { reason: unknown } | null>();

function use(usable: any) {
  if (usable?.[KIND] === CONTEXT) return useContext(usable);
  const result = settled.get(usable);
  if (result) {
    if ("reason" in result) throw result.reason;
    return result.value;
  }
  if (result === undefined) {
    settled.set(usable, null);
    usable.then(
      (value: unknown) => settled.set(usable, { value }),
      (reason: unknown) => settled.set(usable, { reason }),
    );
  }
  throw usable;
}

function lazy(load: () => Promise<{ default: any }>) {
  let loading: Promise<any> | undefined;
  return (props: Props) => jsx((use((loading ??= load())) as any).default, props);
}

function memo(type: any, compare?: (previous: Props, next: Props) => boolean) {
  return { [KIND]: MEMO, type, compare };
}

function forwardRef(render: (props: Props, ref: any) => any) {
  return { [KIND]: FORWARD_REF, render };
}

function createPortal(children: unknown, container: unknown, key?: unknown) {
  return jsx(PORTAL, { children, container }, key);
}

function toArray(children: any, result: any[] = []) {
  if (children == null || typeof children === "boolean") return result;
  if (typeof children === "object" && children[Symbol.iterator]) for (const child of children) toArray(child, result);
  else result.push(children);
  return result;
}

const Children = {
  toArray: (children: unknown) => toArray(children),
  count: (children: unknown) => toArray(children).length,
  map: (children: unknown, map: any) => (children == null ? children : toArray(toArray(children).map(map))),
  forEach: (children: unknown, visit: any) => toArray(children).forEach(visit),
  only(children: unknown) {
    if (!isValidElement(children)) throw new TypeError("Expected a single element");
    return children;
  },
};

function restoreControlled({ target }: { target: any }) {
  flush();
  const isRadio = target.type === "radio" && target.name;
  for (const element of isRadio ? target.ownerDocument.getElementsByName(target.name) : [target]) {
    const fiber = fillers.get(element.$impl)?.[0];
    if (fiber !== undefined) dom.setValue(fiber.node, fiber.props, false);
  }
}

function createRoot(container: any) {
  const root = new Fiber(PORTAL, 0, { container }, null);
  openPortal(root, container);
  container.ownerDocument.defaultView?.addEventListener("input", restoreControlled);
  return {
    render(children: unknown) {
      root.props = { container, children };
      schedule(root);
    },
    unmount() {
      if (!root.unmounted) unmount(root);
    },
  };
}

/** Runs `callback`, then everything that follows from it: events, renders and effects. */
function act(callback?: () => any) {
  const finish = () => {
    do {
      flush();
      runPassiveEffects();
      if (native.isStarted()) native.settle();
    } while (queue.length > 0 || passive.length > 0);
  };
  const result = callback?.();
  return isThenable(result) ? result.then(finish) : finish();
}

native.hooks.render = flush;

export default {
  jsx,
  createRoot,
  api: {
    Children,
    Component,
    Fragment,
    PureComponent,
    StrictMode,
    Suspense,
    act,
    cloneElement,
    createContext,
    createElement,
    createPortal,
    createRoot,
    createRef: () => ({ current: null }),
    flushSync,
    forwardRef,
    isValidElement,
    lazy,
    memo,
    startTransition,
    use,
    useCallback,
    useContext,
    useDebugValue() {},
    useDeferredValue,
    useEffect,
    useEffectEvent,
    useId,
    useImperativeHandle,
    useInsertionEffect: useLayoutEffect,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    useSyncExternalStore,
    useTransition,
  },
};
