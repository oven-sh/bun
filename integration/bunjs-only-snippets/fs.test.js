import { describe, it, expect } from "vitest";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readFile,
} from "node:fs";

const Buffer = globalThis.Buffer || Uint8Array;

if (!import.meta.dir) {
  import.meta.dir = ".";
}

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

  it("returning Buffer works", () => {
    const text = readFileSync(import.meta.dir + "/readFileSync.txt");
    const encoded = [
      70, 105, 108, 101, 32, 114, 101, 97, 100, 32, 115, 117, 99, 99, 101, 115,
      115, 102, 117, 108, 108, 121,
    ];
    for (let i = 0; i < encoded.length; i++) {
      expect(text[i]).toBe(encoded[i]);
    }
  });
});

describe("readFile", () => {
  it("works", async () => {
    await new Promise((resolve, reject) => {
      readFile(import.meta.dir + "/readFileSync.txt", "utf8", (err, text) => {
        expect(text).toBe("File read successfully");
        resolve(true);
      });
    });
  });

  it("returning Buffer works", async () => {
    await new Promise((resolve, reject) => {
      readFile(import.meta.dir + "/readFileSync.txt", (err, text) => {
        const encoded = [
          70, 105, 108, 101, 32, 114, 101, 97, 100, 32, 115, 117, 99, 99, 101,
          115, 115, 102, 117, 108, 108, 121,
        ];
        for (let i = 0; i < encoded.length; i++) {
          expect(text[i]).toBe(encoded[i]);
        }
        resolve(true);
      });
    });
  });
});

describe("writeFileSync", () => {
  it("works", () => {
    const path = `/tmp/${Date.now()}.writeFileSync.txt`;
    writeFileSync(path, "File written successfully", "utf8");

    expect(readFileSync(path, "utf8")).toBe("File written successfully");
  });

  it("returning Buffer works", () => {
    const buffer = new Buffer([
      70, 105, 108, 101, 32, 119, 114, 105, 116, 116, 101, 110, 32, 115, 117,
      99, 99, 101, 115, 115, 102, 117, 108, 108, 121,
    ]);
    const path = `/tmp/${Date.now()}.blob.writeFileSync.txt`;
    writeFileSync(path, buffer);
    const out = readFileSync(path);

    for (let i = 0; i < buffer.length; i++) {
      expect(buffer[i]).toBe(out[i]);
    }
  });
  it("returning ArrayBuffer works", () => {
    const buffer = new Buffer([
      70, 105, 108, 101, 32, 119, 114, 105, 116, 116, 101, 110, 32, 115, 117,
      99, 99, 101, 115, 115, 102, 117, 108, 108, 121,
    ]);
    const path = `/tmp/${Date.now()}.blob2.writeFileSync.txt`;
    writeFileSync(path, buffer);
    const out = readFileSync(path);

    for (let i = 0; i < buffer.length; i++) {
      expect(buffer[i]).toBe(out[i]);
    }
  });
});
