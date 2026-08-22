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

// The Metal objects are only ever created natively (by `gpu.*()` and
// MetalView frames). They still get constructors, which throw, so that
// `bun:appkit` can export the classes for `instanceof`.
function gpuClass(name: string, proto: Record<string, any>, extra: { estimatedSize?: boolean } = {}) {
  return define({
    name,
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    rustPath: `crate::api::appkit::${name}`,
    proto,
    ...extra,
  });
}

const fn = (name: string, length: number) => ({ fn: name, length });
// Every encoder method returns the frame for chaining.
const chained = (...entries: [string, number][]) =>
  Object.fromEntries(entries.map(([name, length]) => [name, fn(name, length)]));

// The dynamic Objective-C bridge. Objects and classes come from message
// sends, `objcLookupClass` and `.native` (their constructors throw);
// `new ObjCSelector(name)` is `objc.sel()`.
function objcClass(name: string, proto: Record<string, any>) {
  return define({
    name,
    construct: true,
    finalize: true,
    configurable: false,
    klass: {},
    rustPath: `crate::api::appkit::${name}`,
    proto,
  });
}

export default [
  objcClass("ObjCObject", {
    msgSend: fn("msgSend", 1),
    className: { getter: "getClassName" },
    isClass: { getter: "getIsClass" },
    address: { getter: "getAddress" },
    release: fn("release", 0),
    released: { getter: "getReleased" },
    toString: fn("toString", 0),
  }),
  objcClass("ObjCClass", {
    msgSend: fn("msgSend", 1),
    name: { getter: "getName" },
    address: { getter: "getAddress" },
    toString: fn("toString", 0),
  }),
  objcClass("ObjCSelector", {
    name: { getter: "getName" },
    toString: fn("toString", 0),
  }),
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
      draw: { fn: "draw", length: 0 },
      drawableSize: { getter: "getDrawableSize" },
      release: { fn: "release", length: 0 },
      released: { getter: "getReleased" },
      native: { getter: "getNative" },
      ...slots(
        "onAction",
        "onChange",
        "onSubmit",
        "onFocus",
        "onBlur",
        "onSelect",
        "onActivate",
        "onFrame",
        "onResize",
      ),
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
      native: { getter: "getNative" },
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
      testing: { fn: "testing", length: 3 },
      ...slots("onBeforeQuit", "onReopen", "onMenu"),
    },
  }),
  define({
    name: "AppKitGpu",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    rustPath: "crate::api::appkit::AppKitGpu",
    proto: {
      available: { getter: "getAvailable" },
      name: { getter: "getName" },
      unifiedMemory: { getter: "getUnifiedMemory" },
      registerErrors: fn("registerErrors", 1),
      buffer: fn("buffer", 2),
      texture: fn("texture", 1),
      library: fn("library", 2),
      renderPipeline: fn("renderPipeline", 1),
      computePipeline: fn("computePipeline", 2),
      sampler: fn("sampler", 1),
      depthStencil: fn("depthStencil", 1),
      frame: fn("frame", 1),
    },
  }),
  // Buffers and textures report their Metal allocation to the collector and
  // can be released early with destroy().
  gpuClass(
    "GpuBuffer",
    {
      byteLength: { getter: "getByteLength" },
      storage: { getter: "getStorage" },
      inFlight: { getter: "getInFlight" },
      destroyed: { getter: "getDestroyed" },
      write: fn("write", 2),
      read: fn("read", 2),
      destroy: fn("destroy", 0),
      label: { getter: "getLabel", setter: "setLabel" },
    },
    { estimatedSize: true },
  ),
  gpuClass(
    "GpuTexture",
    {
      width: { getter: "getWidth" },
      height: { getter: "getHeight" },
      format: { getter: "getFormat" },
      inFlight: { getter: "getInFlight" },
      destroyed: { getter: "getDestroyed" },
      replace: fn("replace", 2),
      readPixels: fn("readPixels", 0),
      destroy: fn("destroy", 0),
      label: { getter: "getLabel", setter: "setLabel" },
    },
    { estimatedSize: true },
  ),
  gpuClass("GpuLibrary", {
    function: fn("function", 1),
    functionNames: { getter: "getFunctionNames" },
    label: { getter: "getLabel", setter: "setLabel" },
  }),
  gpuClass("GpuFunction", {
    name: { getter: "getName" },
    type: { getter: "getType" },
  }),
  gpuClass("GpuRenderPipeline", {
    label: { getter: "getLabel" },
    colorFormats: { getter: "getColorFormats" },
    depthFormat: { getter: "getDepthFormat" },
  }),
  gpuClass("GpuComputePipeline", {
    label: { getter: "getLabel" },
    maxTotalThreadsPerThreadgroup: { getter: "getMaxTotalThreadsPerThreadgroup" },
    threadExecutionWidth: { getter: "getThreadExecutionWidth" },
  }),
  gpuClass("GpuSampler", {
    label: { getter: "getLabel" },
  }),
  gpuClass("GpuDepthStencil", {
    label: { getter: "getLabel" },
  }),
  gpuClass("GpuFrame", {
    committed: { getter: "getCommitted" },
    state: { getter: "getState" },
    gpuStatus: { getter: "getGpuStatus" },
    error: { getter: "getError" },
    label: { getter: "getLabel", setter: "setLabel" },
    ...chained(
      ["renderPass", 2],
      ["pipeline", 1],
      ["vertexBuffer", 3],
      ["vertexBytes", 2],
      ["vertexTexture", 2],
      ["fragmentBuffer", 3],
      ["fragmentBytes", 2],
      ["fragmentTexture", 2],
      ["fragmentSampler", 2],
      ["viewport", 6],
      ["scissor", 4],
      ["cull", 1],
      ["winding", 1],
      ["depthStencil", 1],
      ["draw", 2],
      ["drawIndexed", 3],
      ["computePass", 0],
      ["buffer", 3],
      ["bytes", 2],
      ["texture", 2],
      ["sampler", 2],
      ["dispatch", 2],
      ["dispatchGroups", 2],
      ["blit", 0],
      ["copyBuffer", 3],
      ["generateMipmaps", 1],
      ["pushDebugGroup", 1],
      ["popDebugGroup", 0],
      ["end", 0],
    ),
    commit: fn("commit", 0),
    commitAndWait: fn("commitAndWait", 0),
  }),
];
