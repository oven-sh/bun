// node:diagnostics_channel TracingChannels for module loading.
// https://nodejs.org/api/diagnostics_channel.html#built-in-channels
const { tracingChannel } = require("node:diagnostics_channel");

const requireChannel = tracingChannel("module.require");
const importChannel = tracingChannel("module.import");

// Called from C++ GlobalObject::moduleLoaderImportModule to wrap a dynamic
// import() once a "tracing:module.*" subscriber exists.
function traceDynamicImport(promise, url, parentURL) {
  if (!importChannel.hasSubscribers) return promise;
  return importChannel.tracePromise(() => promise, { __proto__: null, parentURL, url });
}

export default { requireChannel, importChannel, traceDynamicImport };
