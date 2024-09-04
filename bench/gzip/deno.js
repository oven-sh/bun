import { bench, run } from "../node_modules/mitata/src/cli.mjs";

const data = new TextEncoder().encode("Hello World!".repeat(9999));

const compressed = await compress(data);

bench(`roundtrip - "Hello World!".repeat(9999))`, async () => {
  await decompress(await compress(data));
});

bench(`gzip("Hello World!".repeat(9999)))`, async () => {
  await compress(data);
});

bench(`gunzip("Hello World!".repeat(9999)))`, async () => {
  await decompress(compressed);
});

await run();

async function compress(buffer) {
  const cs = new CompressionStream("gzip");

  const writer = cs.writable.getWriter();

  writer.write(buffer);

  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();

  let length = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;
    chunks.push(value);
    length += value.length;
  }

  const u8 = new Uint8Array(length);

  let offset = 0;

  for (const chunk of chunks) {
    u8.set(chunk, offset);
    offset += chunk.length;
  }

  return u8;
}

async function decompress(buffer) {
  const ds = new DecompressionStream("gzip");

  const writer = ds.writable.getWriter();

  writer.write(buffer);

  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();

  let length = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;
    chunks.push(value);
    length += value.length;
  }

  const u8 = new Uint8Array(length);

  let offset = 0;

  for (const chunk of chunks) {
    u8.set(chunk, offset);
    offset += chunk.length;
  }

  return u8;
}
