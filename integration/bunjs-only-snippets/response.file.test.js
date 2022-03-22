import fs from "fs";
import { it, expect } from "bun:test";
import path from "path";
it("Response.file", async () => {
  const file = path.join(import.meta.dir, "fetch.js.txt");
  expect(await Response.file(file).text()).toBe(fs.readFileSync(file, "utf8"));
});

it("Response.file as a blob", async () => {
  const filePath = path.join(import.meta.url, "../fetch.js.txt");
  const fixture = fs.readFileSync(filePath, "utf8");
  // this is a Response object with the same interface as the one returned by fetch
  // internally, instead of a byte array, it stores the file path!
  // this enables several performance optimizations
  var response = Response.file(filePath);

  // at this point, it's still just a file path
  var blob = await response.blob();
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
  expect(blob.size).toBe(fixture.size);
  blob = null;
  response = null;
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 1));
  // now we're back
  var response = Response.file(file);
  var blob = await response.blob();
  expect(blob.size).toBe(0);
});
