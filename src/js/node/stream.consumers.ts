// Hardcoded module "node:stream/consumers" / "readable-stream/consumer"
export async function arrayBuffer(stream): Promise<ArrayBuffer> {
  if ($isReadableStream(stream)) return Bun.readableStreamToArrayBuffer(stream);
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).buffer as ArrayBuffer;
}
export async function text(stream): Promise<string> {
  if ($isReadableStream(stream)) return Bun.readableStreamToText(stream);
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
export async function json(stream): Promise<any> {
  if ($isReadableStream(stream)) return Bun.readableStreamToJSON(stream).then(JSON.parse);
  return JSON.parse(await text(stream));
}
export async function buffer(stream): Promise<Buffer> {
  return new Buffer(await arrayBuffer(stream));
}
async function blob(stream) {
  if ($isReadableStream(stream)) return Bun.readableStreamToBlob(stream).then(JSON.parse);
  const chunks: any[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new Blob(chunks);
}

export default {
  arrayBuffer,
  text,
  json,
  buffer,
  blob,
};
