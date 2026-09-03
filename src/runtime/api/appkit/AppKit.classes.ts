import { define } from "../../../codegen/class-definitions";

// Event slots: JS assigns the handler (`native.onFrame = fn`), the native side
// reads it back through the cached WriteBarrier, and the collector visits it.
function slots(...names: string[]) {
  const proto: Record<string, { getter: string; cache: true; writable: true }> = {};
  for (const name of names) {
    proto[name] = { getter: "get" + name[0].toUpperCase() + name.slice(1), cache: true, writable: true };
  }
  return proto;
}

// A class with native fields whose instances come from native code (only
// `new ObjCSelector(name)` constructs one from a script; the other
// constructors throw), exported by the module for `instanceof`.
function nativeClass(
  name: string,
  proto: Record<string, any>,
  extra: { estimatedSize?: boolean; values?: string[] } = {},
) {
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

// macOS only: other targets generate none of these classes.
const classes = [
  // The dynamic Objective-C bridge. Objects and classes come from message
  // sends, `objcLookupClass` and `.native`; `new ObjCSelector(name)` is
  // `objc.sel()`. An object's `keeper` slot points at the ObjCKeeper of the
  // script functions native code calls through it (a block's, a target's),
  // and an object reports the bytes its NSData / NSString / bitmap holds.
  nativeClass(
    "ObjCObject",
    {
      msgSend: fn("msgSend", 1),
      className: { getter: "getClassName" },
      address: { getter: "getAddress" },
      release: fn("release", 0),
      released: { getter: "getReleased" },
      toString: fn("toString", 0),
    },
    { estimatedSize: true, values: ["keeper"] },
  ),
  nativeClass("ObjCClass", {
    msgSend: fn("msgSend", 1),
    name: { getter: "getName" },
    address: { getter: "getAddress" },
    toString: fn("toString", 0),
  }),
  // One exported C function found with dlsym (`objc.functions.NSBeep`).
  define({
    name: "ObjCFunction",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    rustPath: "crate::api::appkit::ObjCFunction",
    proto: { call: fn("call", 0) },
  }),
  // The functions a block, target or script-defined class calls, kept while
  // the script can reach the object's wrapper or native code holds the object.
  define({
    name: "ObjCKeeper",
    construct: false,
    noConstructor: true,
    finalize: true,
    configurable: false,
    klass: {},
    rustPath: "crate::api::appkit::ObjCKeeper",
    proto: {},
    hasPendingActivity: true,
    values: ["wrapper", "functions"],
  }),
  nativeClass("ObjCSelector", {
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
      draw: { fn: "draw", length: 0 },
      drawableSize: { getter: "getDrawableSize" },
      native: { getter: "getNative" },
      ...slots("onFrame", "onResize"),
    },
  }),
  // The native half of `app`: NSApplication start-up with the script's
  // delegate, the keep-alive, and process exit for an accepted quit.
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
      started: { getter: "getStarted" },
      launched: { fn: "launched", length: 0 },
      quitAccepted: { fn: "quitAccepted", length: 0 },
      exitNow: { fn: "exitNow", length: 0 },
      hold: { fn: "hold", length: 1 },
      testing: { fn: "testing", length: 3 },
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
  // The Metal objects come from `gpu.*()` and MetalView frames. Buffers and
  // textures report their Metal allocation to the collector and can be
  // released early with destroy().
  nativeClass(
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
  nativeClass(
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
  nativeClass("GpuLibrary", {
    function: fn("function", 1),
    functionNames: { getter: "getFunctionNames" },
    label: { getter: "getLabel", setter: "setLabel" },
  }),
  nativeClass("GpuFunction", {
    name: { getter: "getName" },
    type: { getter: "getType" },
  }),
  nativeClass("GpuRenderPipeline", {
    label: { getter: "getLabel" },
    colorFormats: { getter: "getColorFormats" },
    depthFormat: { getter: "getDepthFormat" },
  }),
  nativeClass("GpuComputePipeline", {
    label: { getter: "getLabel" },
    maxTotalThreadsPerThreadgroup: { getter: "getMaxTotalThreadsPerThreadgroup" },
    threadExecutionWidth: { getter: "getThreadExecutionWidth" },
  }),
  nativeClass("GpuSampler", {
    label: { getter: "getLabel" },
  }),
  nativeClass("GpuDepthStencil", {
    label: { getter: "getLabel" },
  }),
  nativeClass("GpuFrame", {
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
for (const def of classes) def.platform = "darwin";

export default classes;
