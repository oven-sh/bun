export const arrayBuffer = Bun.readableStreamToArrayBuffer;
export const text = Bun.readableStreamToText;
export const json = (stream) =>
  Bun.readableStreamToText(stream).then(JSON.parse);

export const buffer = async (readableStream) => {
  return new Buffer(await arrayBuffer(readableStream));
};

export const blob = Bun.readableStreamToBlob;
