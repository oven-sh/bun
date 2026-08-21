import { define } from "../../../codegen/class-definitions";

// Event slots: JS assigns the handler (`native.onAction = fn`), the native side
// reads it back through the cached WriteBarrier, and the collector visits it.
function slots(...names: string[]) {
  const proto: Record<string, { getter: string; cache: true; writable: true }> = {};
  for (const name of names) {
    proto[name] = { getter: "get" + name[0].toUpperCase() + name.slice(1), cache: true, writable: true };
  }
  return proto;
}

export default [
  define({
    name: "AppKitView",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    rustPath: "crate::api::appkit::AppKitView",
    proto: {
      set: { fn: "set", length: 2 },
      get: { fn: "get", length: 1 },
      insertChild: { fn: "insertChild", length: 2 },
      removeChild: { fn: "removeChild", length: 1 },
      click: { fn: "click", length: 0 },
      snapshot: { fn: "snapshot", length: 0 },
      frame: { getter: "getFrame" },
      ...slots("onAction", "onChange", "onSubmit", "onFocus", "onBlur", "onSelect", "onActivate"),
    },
  }),
  define({
    name: "AppKitWindow",
    construct: true,
    constructNeedsThis: true,
    finalize: true,
    configurable: false,
    klass: {},
    rustPath: "crate::api::appkit::AppKitWindow",
    proto: {
      set: { fn: "set", length: 2 },
      get: { fn: "get", length: 1 },
      setContent: { fn: "setContent", length: 1 },
      show: { fn: "show", length: 0 },
      hide: { fn: "hide", length: 0 },
      center: { fn: "center", length: 0 },
      focus: { fn: "focus", length: 0 },
      close: { fn: "close", length: 0 },
      snapshot: { fn: "snapshot", length: 0 },
      closed: { getter: "getClosed" },
      visible: { getter: "getVisible" },
      key: { getter: "getKey" },
      ...slots("onClose", "shouldClose", "onResize", "onMove", "onFocus", "onBlur"),
    },
  }),
  define({
    name: "AppKitApp",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    rustPath: "crate::api::appkit::AppKitApp",
    proto: {
      start: { fn: "start", length: 1 },
      quit: { fn: "quit", length: 0 },
      activate: { fn: "activate", length: 0 },
      hide: { fn: "hide", length: 0 },
      set: { fn: "set", length: 2 },
      isDark: { getter: "getIsDark" },
      hasDisplay: { getter: "getHasDisplay" },
      liveViews: { getter: "getLiveViews" },
      ...slots("onBeforeQuit", "onReopen", "onMenu"),
    },
  }),
];
