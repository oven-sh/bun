// Hardcoded module "node:stream/consumers" / "readable-stream/consumer"
const { Bun } = import.meta.primordials;

export const arrayBuffer = Bun.readableStreamToArrayBuffer;
export const text = Bun.readableStreamToText;
export const json = stream => Bun.readableStreamToText(stream).then(JSON.parse);

export const buffer = async readableStream => {
  return new Buffer(await arrayBuffer(readableStream));
};

export const blob = Bun.readableStreamToBlob;

export default {
  [Symbol.for("CommonJS")]: 0,
  arrayBuffer,
  text,
  json,
  buffer,
  blob,
};
