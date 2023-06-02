var { Bun } = import.meta.primordials, arrayBuffer = Bun.readableStreamToArrayBuffer, text = Bun.readableStreamToText, json = (stream) => Bun.readableStreamToText(stream).then(JSON.parse), buffer = async (readableStream) => {
  return new Buffer(await arrayBuffer(readableStream));
}, blob = Bun.readableStreamToBlob, stream_consumers_default = {
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

//# debugId=25D1F44693FB046864756e2164756e21
