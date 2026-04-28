// Shim for Node.js's internal/test/binding module (normally reached via
// --expose-internals). Only bindings that Bun can meaningfully provide are
// wired up; everything else returns an empty object so that destructuring in
// Node.js tests does not throw.

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
  return {};
}

export default {
  internalBinding,
};
