import { gc } from "bun";
import { describe, expect, it } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFile,
  readFileSync,
  readSync,
  writeFileSync,
  writeSync,
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

it("readdirSync on import.meta.dir", () => {
  const dirs = readdirSync(import.meta.dir);
  expect(dirs.length > 0).toBe(true);
  var match = false;
  gc(true);
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i] === import.meta.file) {
      match = true;
    }
  }
  gc(true);
  expect(match).toBe(true);
});

it("readdirSync on import.meta.dir with trailing slash", () => {
  const dirs = readdirSync(import.meta.dir + "/");
  expect(dirs.length > 0).toBe(true);
  // this file should exist in it
  var match = false;
  for (let i = 0; i < dirs.length; i++) {
    if (dirs[i] === import.meta.file) {
      match = true;
    }
  }
  expect(match).toBe(true);
});

it("readdirSync works on empty directories", () => {
  const path = `/tmp/fs-test-empty-dir-${(
    Math.random() * 100000 +
    100
  ).toString(32)}`;
  mkdirSync(path, { recursive: true });
  expect(readdirSync(path).length).toBe(0);
});

it("readdirSync works on directories with under 32 files", () => {
  const path = `/tmp/fs-test-one-dir-${(Math.random() * 100000 + 100).toString(
    32
  )}`;
  mkdirSync(path, { recursive: true });
  writeFileSync(`${path}/a`, "a");
  const results = readdirSync(path);
  expect(results.length).toBe(1);
  expect(results[0]).toBe("a");
});

it("readdirSync throws when given a file path", () => {
  try {
    readdirSync(import.meta.path);
    throw new Error("should not get here");
  } catch (exception) {
    expect(exception.name).toBe("ENOTDIR");
  }
});

it("readdirSync throws when given a path that doesn't exist", () => {
  try {
    readdirSync(import.meta.path + "/does-not-exist/really");
    throw new Error("should not get here");
  } catch (exception) {
    expect(exception.name).toBe("ENOTDIR");
  }
});

it("readdirSync throws when given a file path with trailing slash", () => {
  try {
    readdirSync(import.meta.path + "/");
    throw new Error("should not get here");
  } catch (exception) {
    expect(exception.name).toBe("ENOTDIR");
  }
});

describe("readSync", () => {
  const firstFourBytes = new Uint32Array(
    new TextEncoder().encode("File").buffer
  )[0];
  it("works with a position set to 0", () => {
    const fd = openSync(import.meta.dir + "/readFileSync.txt", "r");
    const four = new Uint8Array(4);

    {
      const count = readSync(fd, four, 0, 4, 0);
      const u32 = new Uint32Array(four.buffer)[0];
      expect(u32).toBe(firstFourBytes);
      expect(count).toBe(4);
    }
    closeSync(fd);
  });
  it("works without position set", () => {
    const fd = openSync(import.meta.dir + "/readFileSync.txt", "r");
    const four = new Uint8Array(4);
    {
      const count = readSync(fd, four);
      const u32 = new Uint32Array(four.buffer)[0];
      expect(u32).toBe(firstFourBytes);
      expect(count).toBe(4);
    }
    closeSync(fd);
  });
});

describe("writeSync", () => {
  it("works with a position set to 0", () => {
    const fd = openSync(import.meta.dir + "/writeFileSync.txt", "w+");
    const four = new Uint8Array(4);

    {
      const count = writeSync(fd, new TextEncoder().encode("File"), 0, 4, 0);
      expect(count).toBe(4);
    }
    closeSync(fd);
  });
  it("works without position set", () => {
    const fd = openSync(import.meta.dir + "/writeFileSync.txt", "w+");
    const four = new Uint8Array(4);
    {
      const count = writeSync(fd, new TextEncoder().encode("File"));
      expect(count).toBe(4);
    }
    closeSync(fd);
  });
});

describe("readFileSync", () => {
  it("works", () => {
    const text = readFileSync(import.meta.dir + "/readFileSync.txt", "utf8");
    expect(text).toBe("File read successfully");
  });

  it("works with a file url", () => {
    const text = readFileSync(
      new URL("file://" + import.meta.dir + "/readFileSync.txt"),
      "utf8"
    );
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
