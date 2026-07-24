// process.binding("stream_wrap")
//
// Node.js exposes libuv stream state here. Bun's net/stream implementation
// does not route through this buffer, so this is a Node-shape-compatible stub
// that lets packages such as `handle-thing` (pulled in by `spdy` / `restify`)
// load and write into `streamBaseState` without crashing.
// https://github.com/oven-sh/bun/issues/4957

const kNumStreamBaseStateFields = 4;

class ShutdownWrap {
  oncomplete = null;
  callback = null;
  handle = null;
}

class WriteWrap {}

const ObjectDefineProperty = Object.defineProperty;

const binding = {
  ShutdownWrap,
  WriteWrap,
  streamBaseState: new Int32Array(kNumStreamBaseStateFields),
};

ObjectDefineProperty(binding, "kReadBytesOrError", { __proto__: null, value: 0, writable: false, enumerable: true, configurable: false });
ObjectDefineProperty(binding, "kArrayBufferOffset", { __proto__: null, value: 1, writable: false, enumerable: true, configurable: false });
ObjectDefineProperty(binding, "kBytesWritten", { __proto__: null, value: 2, writable: false, enumerable: true, configurable: false });
ObjectDefineProperty(binding, "kLastWriteWasAsync", { __proto__: null, value: 3, writable: false, enumerable: true, configurable: false });

export default binding;
