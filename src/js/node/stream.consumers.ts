// Hardcoded module "node:stream/consumers" / "readable-stream/consumer"
const arrayBuffer = Bun.readableStreamToArrayBuffer;
const text = Bun.readableStreamToText;
const json = stream => Bun.readableStreamToText(stream).then(JSON.parse);

const buffer = async readableStream => {
  return new Buffer(await arrayBuffer(readableStream));
};

const blob = Bun.readableStreamToBlob;

export default {
  arrayBuffer,
  text,
  json,
  buffer,
  blob,
};
