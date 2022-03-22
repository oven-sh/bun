import fs from "fs";
import { it, expect } from "bun:test";
import path from "path";
it("Bun.file", async () => {
  const file = path.join(import.meta.dir, "fetch.js.txt");
  expect(await Bun.file(file).text()).toBe(fs.readFileSync(file, "utf8"));
});

it("Bun.file as a Blob", async () => {
  const filePath = path.join(import.meta.url, "../fetch.js.txt");
  const fixture = fs.readFileSync(filePath, "utf8");
  // this is a Blob object with the same interface as the one returned by fetch
  // internally, instead of a byte array, it stores the file path!
  // this enables several performance optimizations
  var blob = Bun.file(filePath);

  // no size because we haven't read it from disk yet
  expect(blob.size).toBe(0);
  // now it reads "./fetch.js.txt" from the filesystem
  // it's lazy, only loads once we ask for it
  // if it fails, the promise will reject at this point
  expect(await blob.text()).toBe(fixture);
  // now that it's loaded, the size updates
  expect(blob.size).toBe(fixture.length);
  // and it only loads once for _all_ blobs pointing to that file path
  // until all references are released
  expect((await blob.arrayBuffer()).byteLength).toBe(fixture.length);

  const array = new Uint8Array(await blob.arrayBuffer());
  const text = fixture;
  for (let i = 0; i < text.length; i++) {
    expect(array[i]).toBe(text.charCodeAt(i));
  }
  expect(blob.size).toBe(fixture.length);
  blob = null;
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 1));
  // now we're back
  var blob = Bun.file(filePath);
  expect(blob.size).toBe(0);
});

it("Response -> Bun.file", async () => {
  const file = path.join(import.meta.dir, "fetch.js.txt");
  const text = fs.readFileSync(file, "utf8");
  const response = new Response(Bun.file(file));
  expect(await response.text()).toBe(text);
});

it("Response -> Bun.file -> Response -> text", async () => {
  const file = path.join(import.meta.dir, "fetch.js.txt");
  const text = fs.readFileSync(file, "utf8");
  const response = new Response(Bun.file(file));
  const response2 = response.clone();
  expect(await response2.text()).toBe(text);
});
