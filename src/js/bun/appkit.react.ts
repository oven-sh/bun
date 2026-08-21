// Hardcoded module "bun:appkit/react"
//
// A React host renderer over the bun:appkit classes. React itself comes from
// the application's node_modules (react + react-reconciler), loaded on first
// render so that importing this module stays cheap.

const appkit = require("./appkit") as typeof import("./appkit").default;

const PREFIX = "appkit:";
const hostClasses = {
  Window: appkit.Window,
  VStack: appkit.VStack,
  HStack: appkit.HStack,
  ZStack: appkit.ZStack,
  Group: appkit.Group,
  ScrollView: appkit.ScrollView,
  SplitView: appkit.SplitView,
  Text: appkit.Text,
  Button: appkit.Button,
  Checkbox: appkit.Checkbox,
  Radio: appkit.Radio,
  Switch: appkit.Switch,
  TextField: appkit.TextField,
  SecureField: appkit.SecureField,
  SearchField: appkit.SearchField,
  TextEditor: appkit.TextEditor,
  Slider: appkit.Slider,
  Picker: appkit.Picker,
  Segmented: appkit.Segmented,
  Progress: appkit.Progress,
  Image: appkit.Image,
  Divider: appkit.Divider,
  Spacer: appkit.Spacer,
  Table: appkit.Table,
} as const;
type HostName = keyof typeof hostClasses;

/** Elements whose primitive children become a prop instead of child views. */
const textPropByClass = new Map<Function, string>([
  [appkit.Text, "text"],
  [appkit.Button, "title"],
  [appkit.Checkbox, "title"],
  [appkit.Radio, "title"],
  [appkit.Group, "title"],
]);
const hostClassOf = (name: string) => (Object.hasOwn(hostClasses, name) ? hostClasses[name as HostName] : undefined);
const textPropOfName = (name: string) => {
  const Class = hostClassOf(name);
  return Class ? textPropByClass.get(Class) : undefined;
};
const textPropOfInstance = (instance: object) => textPropByClass.get(instance.constructor);
const displayName = (instance: object) => instance.constructor?.name ?? "view";

type HostWindow = InstanceType<typeof appkit.Window>;
type HostView = InstanceType<typeof appkit.View>;
type HostContainer = InstanceType<typeof appkit.Container>;
type HostInstance = HostView | WindowSlot;
type Props = Record<string, any>;
/** Where an element sits: `atRoot` directly under the container, else inside `<parent>`. */
type HostContext = { atRoot: boolean; parent: string | null; textParent: string | null };
type Root = { windows: Set<HostWindow> };
type ErrorHandler = (error: unknown, info: unknown) => void;

// One per primitive child of a text-bearing element; the parent's text is the
// concatenation of its visible pieces.
class TextInstance {
  hidden = false;
  parent: HostView | null = null;
  constructor(public text: string) {}
}

// React's instance for a <Window>. An open native window keeps the process
// alive and React never hands back instances from a render it abandons, so the
// native window only exists while the slot is attached to the root.
class WindowSlot {
  window: HostWindow | null = null;
  content: HostView | null = null;
  constructor(
    public init: Props,
    public pendingShow: boolean,
  ) {}
}

const textPieces = new WeakMap<HostView, TextInstance[]>();

let React: any;
let reconciler: any;
let constants: any;
let currentUpdatePriority = 0;

function loadReact() {
  if (reconciler) return;
  const { createRequire } = require("node:module");
  const base = Bun.main || process.cwd() + "/";
  const requireFromApp = createRequire(base);
  let Reconciler;
  try {
    React = requireFromApp("react");
    Reconciler = requireFromApp("react-reconciler");
    constants = requireFromApp("react-reconciler/constants");
  } catch (cause) {
    throw new Error(
      'bun:appkit/react needs "react" and "react-reconciler" in your project (React 19). Install them with: bun add react react-reconciler',
      { cause },
    );
  }
  if (typeof Reconciler !== "function") Reconciler = Reconciler?.default;
  if (typeof Reconciler !== "function") {
    throw new Error('bun:appkit/react: the installed "react-reconciler" package does not export a reconciler factory');
  }
  if (parseInt(String(React.version), 10) < 19) {
    throw new Error(`bun:appkit/react needs React 19 or newer; found react@${React.version}`);
  }
  for (const name of ["NoEventPriority", "DefaultEventPriority", "DiscreteEventPriority", "ConcurrentRoot"]) {
    if (constants?.[name] === undefined) {
      throw new Error(`bun:appkit/react needs react-reconciler 0.31 or newer (its constants do not export ${name})`);
    }
  }
  const instance = Reconciler(createHostConfig());
  for (const fn of [
    "createContainer",
    "updateContainerSync",
    "flushSyncWork",
    "flushSyncFromReconciler",
    "isAlreadyRendering",
    "defaultOnUncaughtError",
    "defaultOnCaughtError",
  ]) {
    if (typeof instance[fn] !== "function") {
      throw new Error(`bun:appkit/react needs react-reconciler 0.31 or newer (it does not export ${fn})`);
    }
  }
  currentUpdatePriority = constants.NoEventPriority;
  reconciler = instance;
  appkit.__setEventDispatcher(dispatchEvent);
}

function dispatchEvent(handler: Function, args: unknown[]) {
  if (reconciler.isAlreadyRendering()) return handler.$apply(undefined, args);
  const previous = currentUpdatePriority;
  currentUpdatePriority = constants.DiscreteEventPriority;
  try {
    return flushSyncImpl(() => handler.$apply(undefined, args));
  } finally {
    currentUpdatePriority = previous;
  }
}

function flushSyncImpl(fn?: () => unknown) {
  return reconciler.flushSyncFromReconciler(fn);
}

function flushSync(fn?: () => unknown) {
  loadReact();
  return flushSyncImpl(fn);
}

function typeName(type: string): string {
  return type.startsWith(PREFIX) ? type.slice(PREFIX.length) : type;
}

function isTextInstance(node: unknown): node is TextInstance {
  return node instanceof TextInstance;
}

function isPrimitiveChild(children: unknown): boolean {
  return typeof children === "string" || typeof children === "number" || typeof children === "bigint";
}

const applyProp = appkit.__applyProp;

function recomputeText(parent: HostView) {
  const pieces = textPieces.get(parent);
  if (!pieces) return;
  const prop = textPropOfInstance(parent);
  if (!prop) return;
  let text = "";
  for (const piece of pieces) if (!piece.hidden) text += piece.text;
  applyProp(parent, prop, text);
}

function attachText(parent: HostView, piece: TextInstance, before?: unknown) {
  if (!textPropOfInstance(parent)) {
    throw new Error(`<${displayName(parent)}> cannot have text children; wrap the text in <Text>`);
  }
  let pieces = textPieces.get(parent);
  if (!pieces) textPieces.set(parent, (pieces = []));
  const existing = pieces.indexOf(piece);
  if (existing >= 0) pieces.splice(existing, 1);
  let index = before instanceof TextInstance ? pieces.indexOf(before) : -1;
  if (index < 0) pieces.push(piece);
  else pieces.splice(index, 0, piece);
  piece.parent = parent;
  recomputeText(parent);
}

function detachText(parent: HostView, piece: TextInstance) {
  const pieces = textPieces.get(parent);
  if (pieces) {
    const index = pieces.indexOf(piece);
    if (index >= 0) pieces.splice(index, 1);
  }
  piece.parent = null;
  recomputeText(parent);
}

// A <Window> the user closes stays mounted until React removes it; its native
// side throws on every setter from then on, so the host paths below skip it.
function liveWindowOf(slot: WindowSlot): HostWindow | null {
  const window = slot.window;
  return window && !window.closed ? window : null;
}

function setWindowContent(slot: WindowSlot, child: unknown) {
  if (isTextInstance(child)) throw new Error("<Window> cannot have text children; wrap the text in <Text>");
  if (slot.content != null && slot.content !== child) {
    throw new Error("<Window> accepts a single child; wrap the children in a <VStack> or <HStack>");
  }
  slot.content = child as HostView;
  const window = liveWindowOf(slot);
  if (window) window.content = slot.content;
}

function appendChild(parent: HostInstance, child: unknown) {
  if (parent instanceof WindowSlot) return setWindowContent(parent, child);
  if (isTextInstance(child)) return attachText(parent, child);
  if (!(parent instanceof appkit.Container)) {
    throw new Error(`<${displayName(parent)}> cannot have child views`);
  }
  parent.insertBefore(child as HostView, null);
}

function insertBefore(parent: HostInstance, child: unknown, before: unknown) {
  if (parent instanceof WindowSlot) return setWindowContent(parent, child);
  if (isTextInstance(child)) return attachText(parent, child, before);
  if (!(parent instanceof appkit.Container)) {
    throw new Error(`<${displayName(parent)}> cannot have child views`);
  }
  parent.insertBefore(child as HostView, isTextInstance(before) ? null : (before as HostView));
}

function removeChild(parent: HostInstance, child: unknown) {
  if (parent instanceof WindowSlot) {
    if (parent.content !== child) return;
    parent.content = null;
    const window = liveWindowOf(parent);
    if (window) window.content = null;
    return;
  }
  if (isTextInstance(child)) return detachText(parent, child);
  if (child instanceof appkit.View && child.parent === parent) (parent as HostContainer).removeChild(child);
}

// React also calls this to move an attached window among its siblings.
function addWindow(root: Root, child: unknown) {
  if (!(child instanceof WindowSlot)) {
    throw new Error("Only <Window> elements can be rendered at the root");
  }
  child.window ??= new appkit.Window({ ...child.init, visible: false, content: child.content });
  root.windows.add(child.window);
}

function closeWindow(root: Root, window: HostWindow) {
  root.windows.delete(window);
  if (!window.closed) window.close();
}

function removeWindow(root: Root, child: unknown) {
  if (!(child instanceof WindowSlot)) return;
  child.pendingShow = false;
  if (child.window) closeWindow(root, child.window);
}

function initialProps(name: string, props: Props): Props {
  const init: Props = {};
  for (const key in props) {
    if (key === "children" || key === "key" || key === "ref") continue;
    if (props[key] === undefined) continue;
    init[key] = props[key];
  }
  const textProp = textPropOfName(name);
  if (textProp && isPrimitiveChild(props.children)) init[textProp] = String(props.children);
  return init;
}

/** A text-bearing element's text: its primitive child if it has one, else the prop. */
function textOf(textProp: string, props: Props): unknown {
  return isPrimitiveChild(props.children) ? String(props.children) : props[textProp];
}

function checkPlacement(Class: Function, name: string, context: HostContext) {
  if (Class === appkit.Window) {
    if (!context.atRoot) throw new Error(`<Window> must be rendered at the root, not inside <${context.parent}>`);
  } else if (context.atRoot) {
    throw new Error(`<${name}> must be inside a <Window>; only <Window> elements can be rendered at the root`);
  }
}

// Element children are not text: <Group title="…"> is a titled container of views.
function hasTextChild(children: unknown): boolean {
  return isPrimitiveChild(children) || ($isJSArray(children) && children.some(hasTextChild));
}

// A text-bearing element takes its text from one place: the prop or its children.
function checkTextSource(name: string, props: Props) {
  const textProp = textPropOfName(name);
  if (textProp && props[textProp] !== undefined && hasTextChild(props.children)) {
    throw new Error(`<${name}> takes its ${textProp} either as the ${textProp} prop or as children, not both`);
  }
}

function createHostConfig() {
  const { DefaultEventPriority, NoEventPriority } = constants;
  const noop = () => {};

  return {
    // The React DevTools use these when present.
    rendererPackageName: "bun:appkit/react",
    rendererVersion: React.version,
    extraDevToolsConfig: null,

    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    supportsMicrotasks: true,
    supportsTestSelectors: false,
    supportsResources: false,
    supportsSingletons: false,
    isPrimaryRenderer: true,
    warnsIfNotActing: false,

    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,
    noTimeout: -1,
    scheduleMicrotask: queueMicrotask,

    getRootHostContext(): HostContext {
      return { atRoot: true, parent: null, textParent: null };
    },
    getChildHostContext(parent: HostContext, type: string): HostContext {
      const name = typeName(type);
      const textParent = textPropOfName(name) ? name : null;
      if (!parent.atRoot && parent.parent === name && parent.textParent === textParent) return parent;
      return { atRoot: false, parent: name, textParent };
    },
    getPublicInstance(instance: unknown) {
      return instance instanceof WindowSlot ? instance.window : instance;
    },

    prepareForCommit() {
      return null;
    },
    resetAfterCommit() {},
    preparePortalMount: noop,
    detachDeletedInstance: noop,

    createInstance(type: string, props: Props, _root: Root, context: HostContext, _handle: unknown): HostInstance {
      const name = typeName(type);
      const Class = hostClassOf(name);
      if (!Class) {
        throw new Error(`Unknown AppKit element <${name}>. Expected one of: ${Object.keys(hostClasses).join(", ")}`);
      }
      checkPlacement(Class, name, context);
      checkTextSource(name, props);
      const init = initialProps(name, props);
      if (Class === appkit.Window) return new WindowSlot(init, init.visible !== false);
      return new (Class as new (props: Props) => HostView)(init);
    },

    createTextInstance(text: string, _root: Root, context: HostContext, _handle: unknown): TextInstance {
      if (!context.textParent) {
        throw new Error(`Text "${text.length > 40 ? text.slice(0, 40) + "..." : text}" must be wrapped in <Text>`);
      }
      return new TextInstance(text);
    },

    shouldSetTextContent(type: string, props: Props): boolean {
      return textPropOfName(typeName(type)) !== undefined && isPrimitiveChild(props.children);
    },

    appendInitialChild: appendChild,

    finalizeInitialChildren(instance: unknown, _type: string, _props: Props): boolean {
      return instance instanceof WindowSlot;
    },

    // Only Windows ask for this (finalizeInitialChildren); showing here means
    // the window appears with its content already laid out.
    commitMount(instance: unknown, _type: string, _props: Props, _handle: unknown) {
      if (instance instanceof WindowSlot && instance.pendingShow) {
        instance.pendingShow = false;
        liveWindowOf(instance)?.show();
      }
    },

    appendChild,
    appendChildToContainer: addWindow,
    insertBefore,
    insertInContainerBefore(root: Root, child: unknown, _before: unknown) {
      addWindow(root, child);
    },
    removeChild,
    removeChildFromContainer: removeWindow,
    clearContainer(root: Root) {
      for (const window of [...root.windows]) closeWindow(root, window);
    },

    commitUpdate(instance: HostInstance, type: string, prevProps: Props, nextProps: Props, _handle: unknown) {
      const name = typeName(type);
      checkTextSource(name, nextProps);
      let target: HostView | HostWindow;
      let window: HostWindow | null = null;
      if (instance instanceof WindowSlot) {
        window = liveWindowOf(instance);
        if (!window) return;
        target = window;
      } else target = instance;
      // Skipped in the loops; written once below from whichever source nextProps uses.
      const textProp = textPropOfName(name);
      for (const key in prevProps) {
        if (key === "children" || key === "key" || key === "ref" || key === textProp) continue;
        if (prevProps[key] === undefined || nextProps[key] !== undefined) continue;
        if (window && key === "visible") window.show();
        else applyProp(target, key, undefined);
      }
      for (const key in nextProps) {
        if (key === "children" || key === "key" || key === "ref" || key === textProp) continue;
        const next = nextProps[key];
        if (next === undefined || prevProps[key] === next) continue;
        if (window && key === "visible") {
          if (next === false) window.hide();
          else window.show();
          continue;
        }
        applyProp(target, key, next);
      }
      // React commits the children first, so attached text pieces already own the value.
      if (textProp && !textPieces.get(target as HostView)?.length) {
        const next = textOf(textProp, nextProps);
        if (textOf(textProp, prevProps) !== next) applyProp(target, textProp, next);
      }
    },

    commitTextUpdate(piece: TextInstance, _oldText: string, newText: string) {
      piece.text = newText;
      if (piece.parent) recomputeText(piece.parent);
    },

    resetTextContent(instance: HostInstance) {
      const prop = textPropOfInstance(instance);
      if (prop) applyProp(instance as HostView, prop, "");
    },

    hideInstance(instance: HostInstance) {
      if (instance instanceof WindowSlot) liveWindowOf(instance)?.hide();
      else applyProp(instance, "hidden", true);
    },
    unhideInstance(instance: HostInstance, props: Props) {
      if (instance instanceof WindowSlot) {
        if (props.visible !== false) liveWindowOf(instance)?.show();
      } else {
        applyProp(instance, "hidden", !!props.hidden);
      }
    },
    hideTextInstance(piece: TextInstance) {
      piece.hidden = true;
      if (piece.parent) recomputeText(piece.parent);
    },
    unhideTextInstance(piece: TextInstance, text: string) {
      piece.hidden = false;
      piece.text = text;
      if (piece.parent) recomputeText(piece.parent);
    },

    // Update priority (React 19).
    setCurrentUpdatePriority(priority: number) {
      currentUpdatePriority = priority;
    },
    getCurrentUpdatePriority() {
      return currentUpdatePriority;
    },
    resolveUpdatePriority() {
      return currentUpdatePriority !== NoEventPriority ? currentUpdatePriority : DefaultEventPriority;
    },
    resolveEventType() {
      return null;
    },
    resolveEventTimeStamp() {
      return performance.now();
    },
    trackSchedulerEvent: noop,
    shouldAttemptEagerTransition() {
      return false;
    },
    requestPostPaintCallback: noop,

    // Suspensey commits: nothing here ever needs to delay a commit.
    maySuspendCommit() {
      return false;
    },
    maySuspendCommitOnUpdate() {
      return false;
    },
    maySuspendCommitInSyncRender() {
      return false;
    },
    preloadInstance() {
      return true;
    },
    startSuspendingCommit() {
      return null;
    },
    suspendInstance: noop,
    suspendOnActiveViewTransition: noop,
    waitForCommitToBeReady() {
      return null;
    },
    getSuspendedCommitReason() {
      return null;
    },

    // Form actions / transitions.
    NotPendingTransition: null,
    HostTransitionContext: React.createContext(null),
    resetFormInstance: noop,

    // Focus / scopes / misc.
    getInstanceFromNode() {
      return null;
    },
    beforeActiveInstanceBlur: noop,
    afterActiveInstanceBlur: noop,
    prepareScopeUpdate: noop,
    getInstanceFromScope() {
      return null;
    },
    bindToConsole(method: string, args: unknown[], _badgeName: string) {
      return Function.prototype.bind.$apply(console[method], [console, ...args]);
    },
  };
}

type RootOptions = { onError?: ErrorHandler };

class AppKitRoot {
  #root: Root;
  #fiberRoot: unknown;
  #unmounted = false;

  constructor(options?: RootOptions) {
    loadReact();
    const root: Root = (this.#root = { windows: new Set() });
    // Without an onError, an uncaught render error goes to the global
    // reportError() and is an uncaught exception. React's recoverable default
    // also uses reportError(), which is fatal in Bun, so those are only logged.
    const onError = options?.onError;
    this.#fiberRoot = reconciler.createContainer(
      root,
      constants.ConcurrentRoot,
      null, // hydrationCallbacks
      false, // isStrictMode
      null, // concurrentUpdatesByDefaultOverride
      "", // identifierPrefix
      onError ?? reconciler.defaultOnUncaughtError,
      onError ?? reconciler.defaultOnCaughtError,
      onError ?? ((error: unknown) => console.error(error)),
      () => {}, // onDefaultTransitionIndicator
      null, // transitionCallbacks
    );
  }

  get windows(): HostWindow[] {
    return [...this.#root.windows];
  }

  render(element: unknown): this {
    if (this.#unmounted) throw new Error("Cannot render into an unmounted root");
    this.#update(element);
    return this;
  }

  unmount(): void {
    if (this.#unmounted) return;
    this.#unmounted = true;
    this.#update(null);
  }

  // Synchronous so windows exist (or are gone) when render()/unmount() return.
  #update(element: unknown) {
    reconciler.updateContainerSync(element, this.#fiberRoot, null, null);
    reconciler.flushSyncWork();
  }
}

function createRoot(options?: RootOptions) {
  return new AppKitRoot(options);
}

function render(element: unknown, options?: RootOptions) {
  return new AppKitRoot(options).render(element);
}

export default {
  render,
  createRoot,
  flushSync,
  ...(Object.fromEntries(Object.keys(hostClasses).map(name => [name, PREFIX + name])) as Record<HostName, string>),
};
