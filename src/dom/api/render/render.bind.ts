import * as b from "../../../codegen/bindgen-lib.ts";
import * as table from "../../../codegen/builtins/lib.ts";

export default b.module({ rustPath: "crate::api::render", feature: "Desktop", membersInTable: false, isCold: true });

const heap = { capability: "heap" } as const;
const js = { capability: "js", throws: true } as const;
const any = b.any.omittable;
const value = { returns: b.any, ...js } as const;
const fiber = b.ref("Fiber");
const hidden = (name: string, fields: string, typed = {}) =>
  b.interface(name, {
    noInterfaceObject: true,
    rustPath: `crate::api::render::${name}`,
    internalFields: { ...Object.fromEntries(fields.split(" ").map(field => [field, b.any])), ...typed },
  });

export const Renderer = hidden(
  "Renderer",
  "symbols elementStructure queue misplaced doomed committed passive flush runPassiveEffects restoreControlled",
  { current: fiber },
);
export const Fiber = hidden(
  "Fiber",
  "type key props nextProps children handlers hooks effects providers consumers ref releaseRef postponed",
  { parent: fiber, fallback: fiber, node: b.ref("Node"), instance: b.ref("RenderComponent") },
);
export const StateHook = hidden("StateHook", "value reducer dispatch");
export const EffectHook = hidden("EffectHook", "createEffect cleanup deps");
export const MemoHook = hidden("MemoHook", "value deps");

export const RenderComponent = b.interface("RenderComponent", {
  name: "Component",
  rustPath: "crate::api::render::Component",
  inlineCapacity: 2,
  internalFields: { fiber, pending: b.any, callbacks: b.any },
  constants: { isReactComponent: 1 },
  construct: { args: { props: any }, passStructure: true, ...js },
  proto: {
    setState: { args: { state: any, callback: any }, ...heap },
    forceUpdate: { args: { callback: any }, ...heap },
  },
});

export const PureComponent = b.interface("PureComponent", {
  extends: RenderComponent,
  construct: { args: { props: any }, passStructure: true, ...js },
  proto: { shouldComponentUpdate: { args: { props: any, state: any }, returns: b.bool, ...js } },
});

export const RenderRoot = b.interface("RenderRoot", {
  noInterfaceObject: true,
  rustPath: "crate::api::render::RenderRoot",
  internalFields: { fiber },
  proto: { render: { args: { children: any }, ...js }, unmount: js },
});

export const jsx = b.fn({ args: { type: any, props: b.object, key: any }, ...value });

const effect = { args: { create: b.any, deps: any }, ...js } as const;
const element = { args: { type: b.any, props: any, children: b.rest(b.any) }, ...value } as const;

export const renderApi = b.namespace({
  act: { args: { callback: any }, ...value },
  cloneElement: element,
  createContext: { args: { defaultValue: any }, ...value },
  createElement: element,
  createPortal: { args: { children: b.any, container: b.any, key: any }, ...value },
  createRef: value,
  createRoot: { args: { container: b.ref("Node") }, returns: RenderRoot, ...js },
  flushSync: { args: { callback: any }, ...value },
  forwardRef: { args: { render: b.any }, ...value },
  isValidElement: { args: { value: any }, returns: b.bool, ...js },
  lazy: { args: { load: b.any }, returns: b.any, ...heap },
  memo: { args: { type: b.any, compare: any }, ...value },
  startTransition: { args: { callback: b.any }, ...js },
  use: {
    args: { usable: b.any },
    uses: {
      usable: [
        ...table.retainedByNativeCode,
        table.storedByKey(table.keysNamed("status", "value", "reason"), table.nativeMemory),
      ],
    },
    ...value,
  },
  useCallback: { args: { callback: b.any, deps: any }, ...value },
  useContext: { args: { context: b.any }, ...value },
  useDebugValue: {},
  useDeferredValue: { args: { value: any }, ...value },
  useEffect: effect,
  useEffectEvent: { args: { callback: b.any }, ...value },
  useId: value,
  useImperativeHandle: { args: { ref: b.any, create: b.any, deps: any }, ...js },
  useInsertionEffect: effect,
  useLayoutEffect: effect,
  useMemo: { args: { create: b.any, deps: any }, ...value },
  useReducer: { args: { reducer: b.any, initial: any, init: any }, ...value },
  useRef: { args: { initial: any }, ...value },
  useState: { args: { initial: any }, ...value },
  useSyncExternalStore: { args: { subscribe: b.any, getSnapshot: b.any }, ...value },
  useWindow: value,
  useTransition: value,
});

const visit = { args: { children: any, visit: b.any }, ...value } as const;
export const renderChildren = b.namespace({
  toArray: { args: { children: any }, ...value },
  count: { args: { children: any }, returns: b.u32, ...js },
  map: visit,
  forEach: { ...visit, returns: b.undefined },
  only: { args: { children: any }, ...value },
});
