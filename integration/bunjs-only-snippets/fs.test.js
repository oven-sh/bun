import { describe, it, expect } from "bun:test";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";

const tmp = mkdtempSync("fs-test");

describe("mkdirSync", () => {
  it("should create a directory", () => {
    const tempdir = `${tmp}/1234/hi`;
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
    const text = writeFileSync(`${tmp}/writeFileSync.txt`, "utf8");
    expect(text).toBe("File read successfully");
  });
});
