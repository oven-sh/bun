// Wires the "module.require" / "module.import" diagnostics tracing channels
// into the CommonJS require path and dynamic import(). node:diagnostics_channel
// calls install() on load; nothing here runs until it does, and the loaders
// themselves carry no per-call check.

const setHasModuleImportSubscribers = $newCppFunction(
  "NodeDiagnosticsChannel.cpp",
  "jsSetHasModuleImportSubscribers",
  1,
);

let requireChannel;
let importChannel;
// The unwrapped overridableRequire (captured on first install so a user's own
// Module.prototype.require override is what we wrap and restore).
let baseRequire;
let requireWrapped = false;

function tracingRequire(this: any, originalId: string, options?: { paths?: string[] }) {
  if (requireChannel !== undefined && requireChannel.hasSubscribers) {
    return requireChannel.traceSync(
      baseRequire,
      { __proto__: null, parentFilename: this.filename, id: originalId },
      this,
      originalId,
      options,
    );
  }
  return baseRequire.$call(this, originalId, options);
}
Object.defineProperty(tracingRequire, "name", { value: "require" });

function onRequireSubscribersChanged() {
  const has = requireChannel !== undefined && requireChannel.hasSubscribers;
  if (has === requireWrapped) return;
  const Module = require("node:module");
  if (has) {
    baseRequire = Module.prototype.require;
    Module.prototype.require = tracingRequire;
    requireWrapped = true;
  } else {
    // Only unwrap what we wrapped; a user override installed while tracing was
    // active stays.
    if (Module.prototype.require === tracingRequire) {
      Module.prototype.require = baseRequire;
    }
    requireWrapped = false;
  }
}

function onImportSubscribersChanged() {
  setHasModuleImportSubscribers(importChannel !== undefined && importChannel.hasSubscribers);
}

const moduleTracing = {
  // Called from tryTraceModuleImport (C++) only when the import flag is set;
  // `doImport` performs the dynamic import and returns its promise.
  traceImport(doImport, parentURL, url) {
    if (importChannel === undefined || !importChannel.hasSubscribers) {
      return doImport();
    }
    return importChannel.tracePromise(doImport, { __proto__: null, parentURL, url });
  },
  // Called once from node:diagnostics_channel on load. Hooks every sub-channel
  // so gaining/losing a subscriber on any of them re-evaluates the swap.
  install(requireCh, importCh, hookSubscriberChange) {
    requireChannel = requireCh;
    importChannel = importCh;
    hookSubscriberChange(requireCh, onRequireSubscribersChanged);
    hookSubscriberChange(importCh, onImportSubscribersChanged);
    // In case something subscribed before install() ran.
    onRequireSubscribersChanged();
    onImportSubscribersChanged();
  },
};

export default moduleTracing;
