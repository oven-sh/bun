const setHasModuleImportSubscribers = $newCppFunction(
  "NodeDiagnosticsChannel.cpp",
  "jsSetHasModuleImportSubscribers",
  1,
);

let requireChannel;
let importChannel;
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
    baseRequire ??= Module.prototype.require;
    Module.prototype.require = tracingRequire;
    requireWrapped = true;
  } else {
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
  traceImport(doImport, parentURL, url) {
    if (importChannel === undefined || !importChannel.hasSubscribers) {
      return doImport();
    }
    return importChannel.tracePromise(doImport, { __proto__: null, parentURL, url });
  },
  install(requireCh, importCh, hookSubscriberChange) {
    requireChannel = requireCh;
    importChannel = importCh;
    hookSubscriberChange(requireCh, onRequireSubscribersChanged);
    hookSubscriberChange(importCh, onImportSubscribersChanged);
    onRequireSubscribersChanged();
    onImportSubscribersChanged();
  },
};

export default moduleTracing;
