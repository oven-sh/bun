import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pack, Unpack } from "tar";
import { bench, group, run } from "../runner.mjs";

// Check if Bun.Archive is available
const hasBunArchive = typeof Bun !== "undefined" && typeof Bun.Archive !== "undefined";

// Test data sizes
const smallContent = "Hello, World!";
const mediumContent = Buffer.alloc(10 * 1024, "x").toString(); // 10KB
const largeContent = Buffer.alloc(100 * 1024, "x").toString(); // 100KB

// Create test files for node-tar (it reads from filesystem)
const setupDir = mkdtempSync(join(tmpdir(), "archive-bench-setup-"));

function setupNodeTarFiles(prefix, files) {
  const dir = join(setupDir, prefix);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(dir, name);
    const fileDir = join(filePath, "..");
    mkdirSync(fileDir, { recursive: true });
    writeFileSync(filePath, content);
  }
  return dir;
}

// Setup directories for different test cases
const smallFilesDir = setupNodeTarFiles("small", {
  "file1.txt": smallContent,
  "file2.txt": smallContent,
  "file3.txt": smallContent,
});

const mediumFilesDir = setupNodeTarFiles("medium", {
  "file1.txt": mediumContent,
  "file2.txt": mediumContent,
  "file3.txt": mediumContent,
});

const largeFilesDir = setupNodeTarFiles("large", {
  "file1.txt": largeContent,
  "file2.txt": largeContent,
  "file3.txt": largeContent,
});

const manyFilesEntries = {};
for (let i = 0; i < 100; i++) {
  manyFilesEntries[`file${i}.txt`] = smallContent;
}
const manyFilesDir = setupNodeTarFiles("many", manyFilesEntries);

// Pre-create archives for extraction benchmarks
let smallTarGzBuffer, mediumTarGzBuffer, largeTarGzBuffer, manyFilesTarGzBuffer;
let smallBunArchiveGz, mediumBunArchiveGz, largeBunArchiveGz, manyFilesBunArchiveGz;

// Create tar.gz buffers using node-tar
async function createNodeTarGzBuffer(cwd, files) {
  return new Promise(resolve => {
    const pack = new Pack({ cwd, gzip: true });
    const bufs = [];
    pack.on("data", chunk => bufs.push(chunk));
    pack.on("end", () => resolve(Buffer.concat(bufs)));
    for (const file of files) {
      pack.add(file);
    }
    pack.end();
  });
}

// Extract tar.gz buffer using node-tar
async function extractNodeTarGzBuffer(buffer, cwd) {
  return new Promise((resolve, reject) => {
    const unpack = new Unpack({ cwd });
    unpack.on("end", resolve);
    unpack.on("error", reject);
    unpack.end(buffer);
  });
}

// Initialize gzipped archives
smallTarGzBuffer = await createNodeTarGzBuffer(smallFilesDir, ["file1.txt", "file2.txt", "file3.txt"]);
mediumTarGzBuffer = await createNodeTarGzBuffer(mediumFilesDir, ["file1.txt", "file2.txt", "file3.txt"]);
largeTarGzBuffer = await createNodeTarGzBuffer(largeFilesDir, ["file1.txt", "file2.txt", "file3.txt"]);
manyFilesTarGzBuffer = await createNodeTarGzBuffer(manyFilesDir, Object.keys(manyFilesEntries));

if (hasBunArchive) {
  const smallFiles = { "file1.txt": smallContent, "file2.txt": smallContent, "file3.txt": smallContent };
  const mediumFiles = { "file1.txt": mediumContent, "file2.txt": mediumContent, "file3.txt": mediumContent };
  const largeFiles = { "file1.txt": largeContent, "file2.txt": largeContent, "file3.txt": largeContent };

  smallBunArchiveGz = await Bun.Archive.from(smallFiles).bytes("gzip");
  mediumBunArchiveGz = await Bun.Archive.from(mediumFiles).bytes("gzip");
  largeBunArchiveGz = await Bun.Archive.from(largeFiles).bytes("gzip");
  manyFilesBunArchiveGz = await Bun.Archive.from(manyFilesEntries).bytes("gzip");
}

// Create reusable extraction directories (overwriting is fine)
const extractDirNodeTar = mkdtempSync(join(tmpdir(), "archive-bench-extract-node-"));
const extractDirBun = mkdtempSync(join(tmpdir(), "archive-bench-extract-bun-"));

// Benchmarks
group("create .tar.gz (3 small files)", () => {
  bench("node-tar", async () => {
    await createNodeTarGzBuffer(smallFilesDir, ["file1.txt", "file2.txt", "file3.txt"]);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from({
        "file1.txt": smallContent,
        "file2.txt": smallContent,
        "file3.txt": smallContent,
      }).bytes("gzip");
    });
  }
});

group("create .tar.gz (3 x 10KB files)", () => {
  bench("node-tar", async () => {
    await createNodeTarGzBuffer(mediumFilesDir, ["file1.txt", "file2.txt", "file3.txt"]);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from({
        "file1.txt": mediumContent,
        "file2.txt": mediumContent,
        "file3.txt": mediumContent,
      }).bytes("gzip");
    });
  }
});

group("create .tar.gz (3 x 100KB files)", () => {
  bench("node-tar", async () => {
    await createNodeTarGzBuffer(largeFilesDir, ["file1.txt", "file2.txt", "file3.txt"]);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from({
        "file1.txt": largeContent,
        "file2.txt": largeContent,
        "file3.txt": largeContent,
      }).bytes("gzip");
    });
  }
});

group("create .tar.gz (100 small files)", () => {
  bench("node-tar", async () => {
    await createNodeTarGzBuffer(manyFilesDir, Object.keys(manyFilesEntries));
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(manyFilesEntries).bytes("gzip");
    });
  }
});

group("extract .tar.gz (3 small files)", () => {
  bench("node-tar", async () => {
    await extractNodeTarGzBuffer(smallTarGzBuffer, extractDirNodeTar);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(smallBunArchiveGz).extract(extractDirBun);
    });
  }
});

group("extract .tar.gz (3 x 100KB files)", () => {
  bench("node-tar", async () => {
    await extractNodeTarGzBuffer(largeTarGzBuffer, extractDirNodeTar);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(largeBunArchiveGz).extract(extractDirBun);
    });
  }
});

group("extract .tar.gz (100 small files)", () => {
  bench("node-tar", async () => {
    await extractNodeTarGzBuffer(manyFilesTarGzBuffer, extractDirNodeTar);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(manyFilesBunArchiveGz).extract(extractDirBun);
    });
  }
});

await run();

// Cleanup
rmSync(setupDir, { recursive: true, force: true });
rmSync(extractDirNodeTar, { recursive: true, force: true });
rmSync(extractDirBun, { recursive: true, force: true });
