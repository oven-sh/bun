import { describe, it, expect } from "bun:test";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

describe("mkdirSync", () => {
  it("should create a directory", () => {
    const tempdir = `/tmp/fs.test.js/${Date.now()}/1234/hi`;
    expect(existsSync(tempdir)).toBe(false);
    expect(tempdir.includes(mkdirSync(tempdir, { recursive: true }))).toBe(
      true
    );
    expect(existsSync(tempdir)).toBe(true);
  });
});

describe("readFileSync", () => {
  it("works", () => {
    const text = readFileSync(import.meta.dir + "/readFileSync.txt", "utf8");
    expect(text).toBe("File read successfully");
  });
});

describe("writeFileSync", () => {
  it("works", () => {
    const path = `/tmp/${Date.now()}.writeFileSync.txt`;
    writeFileSync(path, "File written successfully", "utf8");

    expect(readFileSync(path, "utf8")).toBe("File written successfully");
  });
});
