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

const constantAttr = { writable: false, enumerable: true, configurable: false };
ObjectDefineProperty(binding, "kReadBytesOrError", { value: 0, ...constantAttr });
ObjectDefineProperty(binding, "kArrayBufferOffset", { value: 1, ...constantAttr });
ObjectDefineProperty(binding, "kBytesWritten", { value: 2, ...constantAttr });
ObjectDefineProperty(binding, "kLastWriteWasAsync", { value: 3, ...constantAttr });

export default binding;
