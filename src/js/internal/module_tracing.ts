// Slots the module loaders publish "module.require" (builtins/CommonJS.ts) and
// "module.import" (ZigGlobalObject.cpp) through. node:diagnostics_channel fills
// them in on load, so a loader never evaluates it just to find no subscribers.
const moduleTracing = {
  // TracingChannel for "module.require", set by node:diagnostics_channel.
  requireChannel: undefined,
  // TracingChannel for "module.import", set by node:diagnostics_channel.
  importChannel: undefined,
  // Called from moduleLoaderImportModule (C++); `doImport` performs the
  // dynamic import and returns its promise.
  traceImport(doImport, parentURL, url) {
    const channel = moduleTracing.importChannel;
    if (channel === undefined || !channel.hasSubscribers) {
      return doImport();
    }
    return channel.tracePromise(doImport, { __proto__: null, parentURL, url });
  },
};

export default moduleTracing;
