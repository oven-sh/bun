const EventEmitter = require("node:events");

const kReadBytesOrError = Symbol("kReadBytesOrError");
const kArrayBufferOffset = Symbol("kArrayBufferOffset");
const kLastWriteWasAsync = Symbol("kLastWriteWasAsync");
const streamBaseState = {
  [kReadBytesOrError]: 0,
  [kArrayBufferOffset]: 0,
  [kLastWriteWasAsync]: 0,
};

class WriteWrap {
  constructor() {
    //
  }
}

export default {
  WriteWrap,
  streamBaseState,
  kReadBytesOrError,
  kArrayBufferOffset,
  kLastWriteWasAsync,
};
