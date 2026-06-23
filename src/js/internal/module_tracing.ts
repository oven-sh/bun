// Holds the diagnostics_channel TracingChannels used by the module loaders:
// "module.require" for the CommonJS require path (builtins/CommonJS.ts) and
// "module.import" for dynamic import() (moduleLoaderImportModule in
// ZigGlobalObject.cpp). node:diagnostics_channel installs the channels here
// when it is first loaded, so a process that never loads diagnostics_channel
// never evaluates that module just to find out nobody subscribed.
const moduleTracing = {
  // TracingChannel for "module.require", set by node:diagnostics_channel.
  requireChannel: undefined,
  // TracingChannel for "module.import", set by node:diagnostics_channel.
  importChannel: undefined,
  // Called from moduleLoaderImportModule (C++) when node:diagnostics_channel
  // is loaded. `doImport` performs the actual dynamic import and returns its
  // promise.
  traceImport(doImport, parentURL, url) {
    const channel = moduleTracing.importChannel;
    if (channel === undefined || !channel.hasSubscribers) {
      return doImport();
    }
    return channel.tracePromise(doImport, { __proto__: null, parentURL, url });
  },
};

export default moduleTracing;
