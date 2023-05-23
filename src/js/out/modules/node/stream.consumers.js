// src/js/node/stream.consumers.js
var { Bun } = import.meta.primordials;
var arrayBuffer = Bun.readableStreamToArrayBuffer;
var text = Bun.readableStreamToText;
var json = (stream) => Bun.readableStreamToText(stream).then(JSON.parse);
var buffer = async (readableStream) => {
  return new Buffer(await arrayBuffer(readableStream));
};
var blob = Bun.readableStreamToBlob;
var stream_consumers_default = {
  [Symbol.for("CommonJS")]: 0,
  arrayBuffer,
  text,
  json,
  buffer,
  blob
};
export {
  text,
  json,
  stream_consumers_default as default,
  buffer,
  blob,
  arrayBuffer
};

//# debugId=C8836FFF903919E264756e2164756e21
