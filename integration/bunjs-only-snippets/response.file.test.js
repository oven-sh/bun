import fs from "fs";
import { it, expect } from "bun:test";
import path from "path";
it("Response.file", async () => {
  const file = path.join(import.meta.dir, "fetch.js.txt");
  expect(await Response.file(file).text()).toBe(fs.readFileSync(file, "utf8"));
});

it("Response.file as a blob", async () => {
  const file = path.join(import.meta.url, "../fetch.js.txt");
  var response = Response.file(file);
  var blob = await response.blob();
  expect(blob.size).toBe(0);
  expect(await blob.text()).toBe(fs.readFileSync(file, "utf8"));
  expect(blob.size).toBe(1256);
  expect(await blob.text()).toBe(fs.readFileSync(file, "utf8"));

  const array = new Uint8Array(await blob.arrayBuffer());
  const text = fs.readFileSync(file, "utf8");
  for (let i = 0; i < text.length; i++) {
    expect(array[i]).toBe(text.charCodeAt(i));
  }
  expect(blob.size).toBe(1256);
  blob = null;
  response = null;
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 1));
});
