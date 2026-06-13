// Shim for Node.js's internal/test/binding module (normally reached via
// --expose-internals). Bindings that have no process.binding equivalent in
// Bun are wired up explicitly; everything else falls through to
// process.binding so unknown names throw just like in Node.

const { constants, nghttp2ErrorString, optionsBuffer } = require("internal/http2/util");

const bindings = {
  __proto__: null,
  http2: {
    constants,
    nghttp2ErrorString,
    optionsBuffer,
  },
};

function internalBinding(name: string) {
  const binding = bindings[name];
  if (binding !== undefined) return binding;
  return process.binding(name);
}

export default {
  internalBinding,
};
