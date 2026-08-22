// Hardcoded module "bun:appkit/react"
//
// A React host renderer over the bun:appkit classes. React itself comes from
// the application (react + react-reconciler): resolved from the entry point's
// directory on first render, or handed over in `modules` by an application
// that bundles its own copy.

const appkit = require("./appkit") as typeof import("./appkit").default;
const core = require("internal/appkit_private") as typeof import("../internal/appkit_private").default;

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
  MetalView: appkit.MetalView,
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
type ChildNode = HostView | TextInstance;
type Props = Record<string, any>;
/** Where an element sits: `atRoot` directly under the container, else inside `<parent>`. */
type HostContext = { atRoot: boolean; parent: string | null; textParent: string | null };
type Root = { windows: Set<HostWindow> };
type ErrorInfo = { componentStack?: string; errorBoundary?: unknown };
type ErrorHandler = (error: unknown, info: ErrorInfo) => void;
type ReactModules = { react: any; reconciler: any; constants: any };
type RootOptions = {
  onUncaughtError?: ErrorHandler;
  onCaughtError?: ErrorHandler;
  onRecoverableError?: ErrorHandler;
  modules?: ReactModules;
};

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

// Present only for text-bearing parents: their children in React's order, text
// pieces and (for <Group>) views together, so either kind can anchor an insert.
const childNodes = new WeakMap<HostView, ChildNode[]>();

let React: any;
let reconciler: any;
let constants: any;
let currentUpdatePriority = 0;

const missingReactMessage =
  'bun:appkit/react needs "react" and "react-reconciler" (React 19): bun add react react-reconciler. ' +
  "An app that bundles React (bun build, bun build --compile) hands its copies over with " +
  "createRoot({ modules: { react, reconciler, constants } }).";

function resolveModules(modules: ReactModules | undefined): { react: any; factory: any; constants: any } {
  let react, factory, resolvedConstants;
  if (modules !== undefined) {
    if (modules === null || typeof modules !== "object") {
      throw new TypeError("modules must be an object { react, reconciler, constants }");
    }
    ({ react, reconciler: factory, constants: resolvedConstants } = modules);
    if (typeof factory !== "function") factory = factory?.default;
    if (react == null || typeof factory !== "function" || resolvedConstants == null) {
      throw new TypeError(
        'modules must be { react, reconciler, constants }: the "react" module, the default export of "react-reconciler" and the "react-reconciler/constants" module',
      );
    }
    return { react, factory, constants: resolvedConstants };
  }
  const { createRequire } = require("node:module");
  const requireFromApp = createRequire(Bun.main || process.cwd() + "/");
  try {
    react = requireFromApp("react");
    factory = requireFromApp("react-reconciler");
    resolvedConstants = requireFromApp("react-reconciler/constants");
  } catch (cause) {
    throw new Error(missingReactMessage, { cause });
  }
  if (typeof factory !== "function") factory = factory?.default;
  if (typeof factory !== "function") {
    throw new Error('bun:appkit/react: the installed "react-reconciler" package does not export a reconciler factory');
  }
  return { react, factory, constants: resolvedConstants };
}

// React, the reconciler and the event dispatcher are process-wide: the first
// root decides where they come from.
function loadReact(modules?: ReactModules) {
  if (reconciler) {
    if (modules !== undefined && resolveModules(modules).react !== React) {
      throw new Error(
        "bun:appkit/react is already using another copy of React; pass the same modules to every createRoot() and render() call, starting with the first",
      );
    }
    return;
  }
  const resolved = resolveModules(modules);
  const reactVersion = String(resolved.react.version);
  if (!(parseInt(reactVersion, 10) >= 19)) {
    throw new Error(`bun:appkit/react needs React 19 or newer; found react@${reactVersion}`);
  }
  for (const name of ["NoEventPriority", "DefaultEventPriority", "DiscreteEventPriority", "ConcurrentRoot"]) {
    if (resolved.constants?.[name] === undefined) {
      throw new Error(`bun:appkit/react needs react-reconciler 0.31 or newer (its constants do not export ${name})`);
    }
  }
  React = resolved.react;
  constants = resolved.constants;
  let instance;
  try {
    instance = resolved.factory(createHostConfig());
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
  } catch (error) {
    React = constants = undefined;
    throw error;
  }
  currentUpdatePriority = constants.NoEventPriority;
  reconciler = instance;
  core.setEventDispatcher(dispatchEvent);
}

function dispatchEvent(handler: Function, args: unknown[]) {
  if (reconciler.isAlreadyRendering()) return handler.$apply(undefined, args);
  const previous = currentUpdatePriority;
  currentUpdatePriority = constants.DiscreteEventPriority;
  try {
    return reconciler.flushSyncFromReconciler(() => handler.$apply(undefined, args));
  } finally {
    currentUpdatePriority = previous;
  }
}

// Before the first root there is nothing to flush, and loading React here
// would fix the default copy ahead of a createRoot({ modules }).
function flushSync(fn?: () => unknown) {
  if (!reconciler) return fn ? fn() : undefined;
  return reconciler.flushSyncFromReconciler(fn);
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

function hasTextPieces(parent: HostView): boolean {
  const nodes = childNodes.get(parent);
  return nodes !== undefined && nodes.some(isTextInstance);
}

function recomputeText(parent: HostView) {
  const nodes = childNodes.get(parent);
  if (!nodes) return;
  const prop = textPropOfInstance(parent);
  if (!prop) return;
  let text = "";
  for (const node of nodes) if (isTextInstance(node) && !node.hidden) text += node.text;
  core.applyProp(parent, prop, text);
}

/** Records `child` at React's position (`before`, or the end) among a text-bearing parent's children. */
function placeNode(parent: HostView, child: ChildNode, before: ChildNode | null) {
  let nodes = childNodes.get(parent);
  if (!nodes) childNodes.set(parent, (nodes = []));
  const existing = nodes.indexOf(child);
  if (existing >= 0) nodes.splice(existing, 1);
  let index = before === null ? -1 : nodes.indexOf(before);
  if (index < 0) index = nodes.length;
  nodes.splice(index, 0, child);
}

function forgetNode(parent: HostView, child: ChildNode) {
  const nodes = childNodes.get(parent);
  if (!nodes) return;
  const index = nodes.indexOf(child);
  if (index >= 0) nodes.splice(index, 1);
}

// Where `child` goes natively among a text-bearing container's views: the
// first view at or after React's anchor, since a text piece is not a view.
function viewAnchor(parent: HostView, child: HostView, before: ChildNode | null): HostView | null {
  const nodes = childNodes.get(parent);
  if (before === null || !nodes) return null;
  for (let i = nodes.indexOf(before); i >= 0 && i < nodes.length; i++) {
    const node = nodes[i];
    if (node !== child && !isTextInstance(node)) return node;
  }
  return null;
}

function insertChild(parent: HostView, child: ChildNode, before: ChildNode | null) {
  const takesText = textPropOfInstance(parent) !== undefined;
  if (isTextInstance(child)) {
    if (!takesText) throw new Error(`<${displayName(parent)}> cannot have text children; wrap the text in <Text>`);
    placeNode(parent, child, before);
    child.parent = parent;
    recomputeText(parent);
    return;
  }
  if (!(parent instanceof appkit.Container)) {
    throw new Error(`<${displayName(parent)}> cannot have child views`);
  }
  if (takesText) {
    parent.insertBefore(child, viewAnchor(parent, child, before));
    placeNode(parent, child, before);
  } else {
    parent.insertBefore(child, before as HostView | null);
  }
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

function appendChild(parent: HostInstance, child: ChildNode) {
  if (parent instanceof WindowSlot) return setWindowContent(parent, child);
  insertChild(parent, child, null);
}

function insertBefore(parent: HostInstance, child: ChildNode, before: ChildNode) {
  if (parent instanceof WindowSlot) return setWindowContent(parent, child);
  insertChild(parent, child, before);
}

function removeChild(parent: HostInstance, child: ChildNode) {
  if (parent instanceof WindowSlot) {
    if (parent.content !== child) return;
    parent.content = null;
    const window = liveWindowOf(parent);
    if (window) window.content = null;
    return;
  }
  forgetNode(parent, child);
  if (isTextInstance(child)) {
    child.parent = null;
    recomputeText(parent);
  } else if (child instanceof appkit.View && child.parent === parent) {
    (parent as HostContainer).removeChild(child);
  }
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
  const { window } = child;
  if (window) closeWindow(root, window);
}

function initialProps(name: string, props: Props): Props {
  const init: Props = {};
  for (const key in props) {
    if (key === "children" || key === "key" || key === "ref") continue;
    if (props[key] === undefined) continue;
    init[key] = props[key];
  }
  const textProp = textPropOfName(name);
  const { children } = props;
  if (textProp && isPrimitiveChild(children)) init[textProp] = String(children);
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
function textSourceError(name: string, props: Props): Error | null {
  const textProp = textPropOfName(name);
  if (textProp && props[textProp] !== undefined && hasTextChild(props.children)) {
    return new Error(`<${name}> takes its ${textProp} either as the ${textProp} prop or as children, not both`);
  }
  return null;
}

// A throw while React commits tears down the whole root and closes every
// window in it, so a prop that cannot be applied to a mounted view is
// reported the way React reports its own misuse and the view keeps its
// previous value. At mount the same prop is a render error instead.
function reportUpdate(name: string, key: string, error: unknown) {
  console.error(`<${name}> ${key}: ${(error as Error)?.message ?? String(error)}. The ${key} update was skipped.`);
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

    // React calls this for every host view it has deleted, the children of a
    // deleted subtree included; the native view is freed here rather than
    // whenever the wrapper is collected. A deleted <Window> was already
    // closed by removeWindow.
    detachDeletedInstance(instance: HostInstance) {
      if (instance instanceof WindowSlot) {
        instance.window = instance.content = null;
        return;
      }
      childNodes.delete(instance);
      core.releaseView(instance);
    },

    createInstance(type: string, props: Props, _root: Root, context: HostContext, _handle: unknown): HostInstance {
      const name = typeName(type);
      const Class = hostClassOf(name);
      if (!Class) {
        throw new Error(`Unknown AppKit element <${name}>. Expected one of: ${Object.keys(hostClasses).join(", ")}`);
      }
      checkPlacement(Class, name, context);
      const misuse = textSourceError(name, props);
      if (misuse) throw misuse;
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
      for (const window of Array.from(root.windows)) closeWindow(root, window);
    },

    commitUpdate(instance: HostInstance, type: string, prevProps: Props, nextProps: Props, _handle: unknown) {
      const name = typeName(type);
      let target: HostView | HostWindow;
      let window: HostWindow | null = null;
      if (instance instanceof WindowSlot) {
        window = liveWindowOf(instance);
        if (!window) return;
        target = window;
      } else target = instance;
      const update = (key: string, value: unknown) => {
        if (window) {
          if (key === "visible") {
            if (value === false) window.hide();
            else window.show();
            return;
          }
          if (core.windowCreateOnly.includes(key)) {
            const kept = JSON.stringify((instance as WindowSlot).init[key]);
            console.error(`<Window> ${key} cannot change after the window is created; it keeps ${key}={${kept}}.`);
            return;
          }
        }
        try {
          core.applyProp(target, key, value);
        } catch (error) {
          reportUpdate(name, key, error);
        }
      };
      // Skipped in the loops; written once below from whichever source nextProps uses.
      const textProp = textPropOfName(name);
      for (const key in prevProps) {
        if (key === "children" || key === "key" || key === "ref" || key === textProp) continue;
        if (prevProps[key] === undefined || nextProps[key] !== undefined) continue;
        update(key, undefined);
      }
      for (const key in nextProps) {
        if (key === "children" || key === "key" || key === "ref" || key === textProp) continue;
        const next = nextProps[key];
        if (next === undefined || prevProps[key] === next) continue;
        update(key, next);
      }
      if (textProp) {
        const misuse = textSourceError(name, nextProps);
        if (misuse) reportUpdate(name, textProp, misuse);
        // React commits the children first, so attached text pieces already own the value.
        else if (!hasTextPieces(target as HostView)) {
          const next = textOf(textProp, nextProps);
          if (textOf(textProp, prevProps) !== next) update(textProp, next);
        }
      }
    },

    commitTextUpdate(piece: TextInstance, _oldText: string, newText: string) {
      piece.text = newText;
      const { parent } = piece;
      if (parent) recomputeText(parent);
    },

    resetTextContent(instance: HostInstance) {
      const prop = textPropOfInstance(instance);
      if (prop) core.applyProp(instance as HostView, prop, "");
    },

    hideInstance(instance: HostInstance) {
      if (instance instanceof WindowSlot) liveWindowOf(instance)?.hide();
      else core.applyProp(instance, "hidden", true);
    },
    unhideInstance(instance: HostInstance, props: Props) {
      if (instance instanceof WindowSlot) {
        if (props.visible !== false) liveWindowOf(instance)?.show();
      } else {
        core.applyProp(instance, "hidden", !!props.hidden);
      }
    },
    hideTextInstance(piece: TextInstance) {
      piece.hidden = true;
      const { parent } = piece;
      if (parent) recomputeText(parent);
    },
    unhideTextInstance(piece: TextInstance, text: string) {
      piece.hidden = false;
      piece.text = text;
      const { parent } = piece;
      if (parent) recomputeText(parent);
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

const errorChannels = ["onUncaughtError", "onCaughtError", "onRecoverableError"] as const;

class AppKitRoot {
  #root: Root;
  #fiberRoot: unknown;
  #unmounted = false;

  constructor(options?: RootOptions) {
    if (options == null) options = {};
    else if (typeof options !== "object") throw new TypeError("options must be an object");
    for (const name of errorChannels) {
      if (options[name] != null && typeof options[name] !== "function") {
        throw new TypeError(`${name} must be a function`);
      }
    }
    loadReact(options.modules);
    const root: Root = (this.#root = { windows: new Set() });
    // The defaults are react-dom's: an uncaught error is reported through
    // reportError() (an uncaught exception in Bun) and a caught one is logged.
    // React's recoverable-error default also goes through reportError(),
    // which would make a render React recovered from fatal, so it is logged.
    this.#fiberRoot = reconciler.createContainer(
      root,
      constants.ConcurrentRoot,
      null, // hydrationCallbacks
      false, // isStrictMode
      null, // concurrentUpdatesByDefaultOverride
      "", // identifierPrefix
      options.onUncaughtError ?? reconciler.defaultOnUncaughtError,
      options.onCaughtError ?? reconciler.defaultOnCaughtError,
      options.onRecoverableError ?? ((error: unknown) => console.error(error)),
      () => {}, // onDefaultTransitionIndicator
      null, // transitionCallbacks
    );
  }

  get windows(): HostWindow[] {
    return [...this.#root.windows];
  }

  render(element: unknown): void {
    if (this.#unmounted) throw new Error("Cannot render into an unmounted root");
    this.#update(element);
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
  const root = new AppKitRoot(options);
  root.render(element);
  return root;
}

export default {
  render,
  createRoot,
  flushSync,
  ...(Object.fromEntries(Object.keys(hostClasses).map(name => [name, PREFIX + name])) as Record<HostName, string>),
};
