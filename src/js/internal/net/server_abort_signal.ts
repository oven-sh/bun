const { validateAbortSignal } = require("internal/validators");

let addAbortListener;

// listen({ signal }) for net.Server and http.Server (which does not inherit from
// net.Server here, unlike Node).
// https://github.com/nodejs/node/blob/v26.3.0/lib/net.js (addServerAbortSignalOption)
function addServerAbortSignalOption(self, options) {
  if (options?.signal === undefined) {
    return;
  }
  validateAbortSignal(options.signal, "options.signal");
  const { signal } = options;
  const onAborted = () => {
    self.close();
  };
  if (signal.aborted) {
    process.nextTick(onAborted);
  } else {
    addAbortListener ??= require("internal/abort_listener").addAbortListener;
    const disposable = addAbortListener(signal, onAborted);
    self.once("close", disposable[Symbol.dispose]);
  }
}

export default {
  addServerAbortSignalOption,
};
