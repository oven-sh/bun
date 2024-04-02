
// @ts-nocheck
import { ServeOptions } from "bun";
import { afterAll, expect, } from "bun:test";

async function runInServer(opts: ServeOptions, cb: (url: string) => void | Promise<void>) {
  try {
    await cb('http://paperback:49774');
  } catch (e) {
    throw e;
  } finally {
  }
}

var bytes = new Uint8Array(1024 * 1024 * 2);
bytes.fill(0x41);

const thisArray = new Int16Array(bytes);
const expectedHash = Bun.SHA1.hash(thisArray, "base64");
const expectedSize = thisArray.byteLength;

var called = false;

await runInServer(
  {
  },
  async url => {
    const response = await fetch(url, {
      body: thisArray,
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-custom": "hello",
        "x-typed-array": thisArray.constructor.name,
      },
      verbose: true,
    });
    expect(response.status).toBe(200);
    const response_body = new Uint8Array(await response.arrayBuffer());

    expect(response_body.byteLength).toBe(expectedSize);
    expect(Bun.SHA1.hash(response_body, "base64")).toBe(expectedHash);

    if (!response.headers.has("content-type")) {
      console.error(Object.fromEntries(response.headers.entries()));
    }

    expect(response.headers.get("content-type")).toBe("text/plain");
  },
);