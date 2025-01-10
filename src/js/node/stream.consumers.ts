// Hardcoded module "node:stream/consumers" / "readable-stream/consumer"
"use strict";

const { Buffer } = require("node:buffer");

const JSONParse = JSON.parse;

async function blob(stream): Promise<Blob> {
  if ($isReadableStream(stream)) return Bun.readableStreamToBlob(stream).then(JSON.parse);
  const chunks: (Blob | ArrayBuffer | string | NodeJS.ArrayBufferView)[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new Blob(chunks);
}

async function arrayBuffer(stream): Promise<ArrayBuffer> {
  if ($isReadableStream(stream)) return Bun.readableStreamToArrayBuffer(stream);
  const ret = await blob(stream);
  return ret.arrayBuffer();
}

async function buffer(stream): Promise<Buffer> {
  return Buffer.from(await arrayBuffer(stream));
}

async function text(stream): Promise<string> {
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

async function json(stream): Promise<any> {
  if ($isReadableStream(stream)) return Bun.readableStreamToJSON(stream).then(JSON.parse);
  const str = await text(stream);
  return JSONParse(str);
}

export default {
  arrayBuffer,
  text,
  json,
  buffer,
  blob,
};
