// Hardcoded module "node:stream/consumers" / "readable-stream/consumer"
const JSONParse = JSON.parse;

async function blob(stream): Promise<Blob> {
  if ($inheritsReadableStream(stream)) return Bun.readableStreamToBlob(stream);
  const chunks: (Blob | ArrayBuffer | string | NodeJS.ArrayBufferView)[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new Blob(chunks);
}

async function arrayBuffer(stream): Promise<ArrayBuffer> {
  if ($inheritsReadableStream(stream)) return Bun.readableStreamToArrayBuffer(stream);
  const ret = await blob(stream);
  return ret.arrayBuffer();
}

async function bytes(stream): Promise<Uint8Array> {
  if ($inheritsReadableStream(stream)) return Bun.readableStreamToBytes(stream);
  const ret = await blob(stream);
  return ret.bytes();
}

async function buffer(stream): Promise<Buffer> {
  return Buffer.from(await arrayBuffer(stream));
}

async function text(stream): Promise<string> {
  if ($inheritsReadableStream(stream)) return Bun.readableStreamToText(stream);
  const dec = new TextDecoder();
  let str = "";
  for await (const chunk of stream) {
    if (typeof chunk === "string") str += chunk;
    else str += dec.decode(chunk, { stream: true });
  }
  // Flush the streaming TextDecoder so that any pending
  // incomplete multibyte characters are handled.
  str += dec.decode(undefined, { stream: false });
  return str;
}

async function json(stream): Promise<any> {
  if ($inheritsReadableStream(stream)) return Bun.readableStreamToJSON(stream);
  const str = await text(stream);
  return JSONParse(str);
}

export default {
  arrayBuffer,
  bytes,
  text,
  json,
  buffer,
  blob,
};
