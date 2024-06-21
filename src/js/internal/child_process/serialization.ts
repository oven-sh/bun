const v8 = require("node:v8");
const { StringDecoder } = require("node:string_decoder");

const { streamBaseState, kLastWriteWasAsync } = require("internal/child_process/write_wrap");

const TypedArrayPrototypeSubarray = Uint8Array.prototype.subarray;
const JSONParse = JSON.parse;
const JSONStringify = JSON.stringify;
const StringPrototypeSplit = String.prototype.split;
const ArrayPrototypePush = Array.prototype.push;

const kMessageBuffer = Symbol("kMessageBuffer");
const kMessageBufferSize = Symbol("kMessageBufferSize");
const kJSONBuffer = Symbol("kJSONBuffer");
const kStringDecoder = Symbol("kStringDecoder");

// Extend V8's serializer APIs to give more JSON-like behaviour in
// some cases; in particular, for native objects this serializes them the same
// way that JSON does rather than throwing an exception.
const kArrayBufferViewTag = 0;
const kNotArrayBufferViewTag = 1;
class ChildProcessSerializer extends v8.DefaultSerializer {
  _writeHostObject(object) {
    // if (isArrayBufferView(object)) {
    if ($isTypedArrayView(object)) {
      this.writeUint32(kArrayBufferViewTag);
      return super._writeHostObject(object);
    }
    this.writeUint32(kNotArrayBufferViewTag);
    this.writeValue({ ...object });
  }
}

class ChildProcessDeserializer extends v8.DefaultDeserializer {
  constructor(data: NodeJS.TypedArray) {
    super(data);
  }
  _readHostObject() {
    const tag = this.readUint32();
    if (tag === kArrayBufferViewTag) return super._readHostObject();

    $assert(tag === kNotArrayBufferViewTag);
    return this.readValue();
  }
}

// Messages are parsed in either of the following formats:
// - Newline-delimited JSON, or
// - V8-serialized buffers, prefixed with their length as a big endian uint32
//   (aka 'advanced')
const advanced = {
  initMessageChannel(channel) {
    channel[kMessageBuffer] = [];
    channel[kMessageBufferSize] = 0;
    channel.buffering = false;
  },

  *parseChannelMessages(channel, readData) {
    if (readData.length === 0) return;

    ArrayPrototypePush.$call(channel[kMessageBuffer], readData);
    channel[kMessageBufferSize] += readData.length;

    // Index 0 should always be present because we just pushed data into it.
    let messageBufferHead = channel[kMessageBuffer][0];
    while (messageBufferHead.length >= 4) {
      // We call `readUInt32BE` manually here, because this is faster than first converting
      // it to a buffer and using `readUInt32BE` on that.
      const fullMessageSize =
        ((messageBufferHead[0] << 24) |
          (messageBufferHead[1] << 16) |
          (messageBufferHead[2] << 8) |
          messageBufferHead[3]) +
        4;

      if (channel[kMessageBufferSize] < fullMessageSize) break;

      const concatenatedBuffer =
        channel[kMessageBuffer].length === 1
          ? channel[kMessageBuffer][0]
          : Buffer.concat(channel[kMessageBuffer], channel[kMessageBufferSize]);

      const deserializer = new ChildProcessDeserializer(
        TypedArrayPrototypeSubarray.$call(concatenatedBuffer, 4, fullMessageSize),
      );

      messageBufferHead = TypedArrayPrototypeSubarray.$call(concatenatedBuffer, fullMessageSize);
      channel[kMessageBufferSize] = messageBufferHead.length;
      channel[kMessageBuffer] = channel[kMessageBufferSize] !== 0 ? [messageBufferHead] : [];

      deserializer.readHeader();
      yield deserializer.readValue();
    }

    channel.buffering = channel[kMessageBufferSize] > 0;
  },

  writeChannelMessage(channel, req, message, handle) {
    const ser = new ChildProcessSerializer();
    // Add 4 bytes, to later populate with message length
    ser.writeRawBytes(Buffer.allocUnsafe(4));
    ser.writeHeader();
    ser.writeValue(message);

    const serializedMessage = ser.releaseBuffer();
    const serializedMessageLength = serializedMessage.length - 4;

    serializedMessage.set(
      [
        (serializedMessageLength >> 24) & 0xff,
        (serializedMessageLength >> 16) & 0xff,
        (serializedMessageLength >> 8) & 0xff,
        serializedMessageLength & 0xff,
      ],
      0,
    );

    const result = channel.writeBuffer(req, serializedMessage, handle);

    // Mirror what stream_base_commons.js does for Buffer retention.
    if (streamBaseState[kLastWriteWasAsync]) req.buffer = serializedMessage;

    return result;
  },
};

const json = {
  initMessageChannel(channel) {
    channel[kJSONBuffer] = "";
    channel[kStringDecoder] = undefined;
  },

  *parseChannelMessages(channel, readData) {
    if (readData.length === 0) return;

    if (channel[kStringDecoder] === undefined) channel[kStringDecoder] = new StringDecoder("utf8");
    const chunks = StringPrototypeSplit(channel[kStringDecoder].write(readData), "\n");
    const numCompleteChunks = chunks.length - 1;
    // Last line does not have trailing linebreak
    const incompleteChunk = chunks[numCompleteChunks];
    if (numCompleteChunks === 0) {
      channel[kJSONBuffer] += incompleteChunk;
    } else {
      chunks[0] = channel[kJSONBuffer] + chunks[0];
      for (let i = 0; i < numCompleteChunks; i++) yield JSONParse(chunks[i]);
      channel[kJSONBuffer] = incompleteChunk;
    }
    channel.buffering = channel[kJSONBuffer].length !== 0;
  },

  writeChannelMessage(channel, req, message, handle) {
    const string = JSONStringify(message) + "\n";
    return channel.writeUtf8String(req, string, handle);
  },
};

export default {
  advanced,
  json,
};
