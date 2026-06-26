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
let smallTarBuffer, mediumTarBuffer, largeTarBuffer, manyFilesTarBuffer;
let smallBunArchiveGz, mediumBunArchiveGz, largeBunArchiveGz, manyFilesBunArchiveGz;
let smallBunArchive, mediumBunArchive, largeBunArchive, manyFilesBunArchive;

// Create tar buffer using node-tar (with optional gzip)
async function createNodeTarBuffer(cwd, files, gzip = false) {
  return new Promise(resolve => {
    const pack = new Pack({ cwd, gzip });
    const bufs = [];
    pack.on("data", chunk => bufs.push(chunk));
    pack.on("end", () => resolve(Buffer.concat(bufs)));
    for (const file of files) {
      pack.add(file);
    }
    pack.end();
  });
}

// Extract tar buffer using node-tar
async function extractNodeTarBuffer(buffer, cwd) {
  return new Promise((resolve, reject) => {
    const unpack = new Unpack({ cwd });
    unpack.on("end", resolve);
    unpack.on("error", reject);
    unpack.end(buffer);
  });
}

// Initialize gzipped archives
smallTarGzBuffer = await createNodeTarBuffer(smallFilesDir, ["file1.txt", "file2.txt", "file3.txt"], true);
mediumTarGzBuffer = await createNodeTarBuffer(mediumFilesDir, ["file1.txt", "file2.txt", "file3.txt"], true);
largeTarGzBuffer = await createNodeTarBuffer(largeFilesDir, ["file1.txt", "file2.txt", "file3.txt"], true);
manyFilesTarGzBuffer = await createNodeTarBuffer(manyFilesDir, Object.keys(manyFilesEntries), true);

// Initialize uncompressed archives
smallTarBuffer = await createNodeTarBuffer(smallFilesDir, ["file1.txt", "file2.txt", "file3.txt"], false);
mediumTarBuffer = await createNodeTarBuffer(mediumFilesDir, ["file1.txt", "file2.txt", "file3.txt"], false);
largeTarBuffer = await createNodeTarBuffer(largeFilesDir, ["file1.txt", "file2.txt", "file3.txt"], false);
manyFilesTarBuffer = await createNodeTarBuffer(manyFilesDir, Object.keys(manyFilesEntries), false);

const smallFiles = { "file1.txt": smallContent, "file2.txt": smallContent, "file3.txt": smallContent };
const mediumFiles = { "file1.txt": mediumContent, "file2.txt": mediumContent, "file3.txt": mediumContent };
const largeFiles = { "file1.txt": largeContent, "file2.txt": largeContent, "file3.txt": largeContent };

if (hasBunArchive) {
  smallBunArchiveGz = await Bun.Archive.from(smallFiles).bytes("gzip");
  mediumBunArchiveGz = await Bun.Archive.from(mediumFiles).bytes("gzip");
  largeBunArchiveGz = await Bun.Archive.from(largeFiles).bytes("gzip");
  manyFilesBunArchiveGz = await Bun.Archive.from(manyFilesEntries).bytes("gzip");

  smallBunArchive = await Bun.Archive.from(smallFiles).bytes();
  mediumBunArchive = await Bun.Archive.from(mediumFiles).bytes();
  largeBunArchive = await Bun.Archive.from(largeFiles).bytes();
  manyFilesBunArchive = await Bun.Archive.from(manyFilesEntries).bytes();
}

// Create reusable extraction directories (overwriting is fine)
const extractDirNodeTar = mkdtempSync(join(tmpdir(), "archive-bench-extract-node-"));
const extractDirBun = mkdtempSync(join(tmpdir(), "archive-bench-extract-bun-"));
const writeDirNodeTar = mkdtempSync(join(tmpdir(), "archive-bench-write-node-"));
const writeDirBun = mkdtempSync(join(tmpdir(), "archive-bench-write-bun-"));

// ============================================================================
// Create .tar (uncompressed) benchmarks
// ============================================================================

group("create .tar (3 small files)", () => {
  bench("node-tar", async () => {
    await createNodeTarBuffer(smallFilesDir, ["file1.txt", "file2.txt", "file3.txt"], false);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(smallFiles).bytes();
    });
  }
});

group("create .tar (3 x 100KB files)", () => {
  bench("node-tar", async () => {
    await createNodeTarBuffer(largeFilesDir, ["file1.txt", "file2.txt", "file3.txt"], false);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(largeFiles).bytes();
    });
  }
});

group("create .tar (100 small files)", () => {
  bench("node-tar", async () => {
    await createNodeTarBuffer(manyFilesDir, Object.keys(manyFilesEntries), false);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(manyFilesEntries).bytes();
    });
  }
});

// ============================================================================
// Create .tar.gz (compressed) benchmarks
// ============================================================================

group("create .tar.gz (3 small files)", () => {
  bench("node-tar", async () => {
    await createNodeTarBuffer(smallFilesDir, ["file1.txt", "file2.txt", "file3.txt"], true);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(smallFiles).bytes("gzip");
    });
  }
});

group("create .tar.gz (3 x 100KB files)", () => {
  bench("node-tar", async () => {
    await createNodeTarBuffer(largeFilesDir, ["file1.txt", "file2.txt", "file3.txt"], true);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(largeFiles).bytes("gzip");
    });
  }
});

group("create .tar.gz (100 small files)", () => {
  bench("node-tar", async () => {
    await createNodeTarBuffer(manyFilesDir, Object.keys(manyFilesEntries), true);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(manyFilesEntries).bytes("gzip");
    });
  }
});

// ============================================================================
// Extract .tar (uncompressed) benchmarks
// ============================================================================

group("extract .tar (3 small files)", () => {
  bench("node-tar", async () => {
    await extractNodeTarBuffer(smallTarBuffer, extractDirNodeTar);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(smallBunArchive).extract(extractDirBun);
    });
  }
});

group("extract .tar (3 x 100KB files)", () => {
  bench("node-tar", async () => {
    await extractNodeTarBuffer(largeTarBuffer, extractDirNodeTar);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(largeBunArchive).extract(extractDirBun);
    });
  }
});

group("extract .tar (100 small files)", () => {
  bench("node-tar", async () => {
    await extractNodeTarBuffer(manyFilesTarBuffer, extractDirNodeTar);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(manyFilesBunArchive).extract(extractDirBun);
    });
  }
});

// ============================================================================
// Extract .tar.gz (compressed) benchmarks
// ============================================================================

group("extract .tar.gz (3 small files)", () => {
  bench("node-tar", async () => {
    await extractNodeTarBuffer(smallTarGzBuffer, extractDirNodeTar);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(smallBunArchiveGz).extract(extractDirBun);
    });
  }
});

group("extract .tar.gz (3 x 100KB files)", () => {
  bench("node-tar", async () => {
    await extractNodeTarBuffer(largeTarGzBuffer, extractDirNodeTar);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(largeBunArchiveGz).extract(extractDirBun);
    });
  }
});

group("extract .tar.gz (100 small files)", () => {
  bench("node-tar", async () => {
    await extractNodeTarBuffer(manyFilesTarGzBuffer, extractDirNodeTar);
  });

  if (hasBunArchive) {
    bench("Bun.Archive", async () => {
      await Bun.Archive.from(manyFilesBunArchiveGz).extract(extractDirBun);
    });
  }
});

// ============================================================================
// Write .tar to disk benchmarks
// ============================================================================

let writeCounter = 0;

group("write .tar to disk (3 small files)", () => {
  bench("node-tar + writeFileSync", async () => {
    const buffer = await createNodeTarBuffer(smallFilesDir, ["file1.txt", "file2.txt", "file3.txt"], false);
    writeFileSync(join(writeDirNodeTar, `archive-${writeCounter++}.tar`), buffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.write", async () => {
      await Bun.Archive.write(join(writeDirBun, `archive-${writeCounter++}.tar`), smallFiles);
    });
  }
});

group("write .tar to disk (3 x 100KB files)", () => {
  bench("node-tar + writeFileSync", async () => {
    const buffer = await createNodeTarBuffer(largeFilesDir, ["file1.txt", "file2.txt", "file3.txt"], false);
    writeFileSync(join(writeDirNodeTar, `archive-${writeCounter++}.tar`), buffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.write", async () => {
      await Bun.Archive.write(join(writeDirBun, `archive-${writeCounter++}.tar`), largeFiles);
    });
  }
});

group("write .tar to disk (100 small files)", () => {
  bench("node-tar + writeFileSync", async () => {
    const buffer = await createNodeTarBuffer(manyFilesDir, Object.keys(manyFilesEntries), false);
    writeFileSync(join(writeDirNodeTar, `archive-${writeCounter++}.tar`), buffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.write", async () => {
      await Bun.Archive.write(join(writeDirBun, `archive-${writeCounter++}.tar`), manyFilesEntries);
    });
  }
});

// ============================================================================
// Write .tar.gz to disk benchmarks
// ============================================================================

group("write .tar.gz to disk (3 small files)", () => {
  bench("node-tar + writeFileSync", async () => {
    const buffer = await createNodeTarBuffer(smallFilesDir, ["file1.txt", "file2.txt", "file3.txt"], true);
    writeFileSync(join(writeDirNodeTar, `archive-${writeCounter++}.tar.gz`), buffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.write", async () => {
      await Bun.Archive.write(join(writeDirBun, `archive-${writeCounter++}.tar.gz`), smallFiles, "gzip");
    });
  }
});

group("write .tar.gz to disk (3 x 100KB files)", () => {
  bench("node-tar + writeFileSync", async () => {
    const buffer = await createNodeTarBuffer(largeFilesDir, ["file1.txt", "file2.txt", "file3.txt"], true);
    writeFileSync(join(writeDirNodeTar, `archive-${writeCounter++}.tar.gz`), buffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.write", async () => {
      await Bun.Archive.write(join(writeDirBun, `archive-${writeCounter++}.tar.gz`), largeFiles, "gzip");
    });
  }
});

group("write .tar.gz to disk (100 small files)", () => {
  bench("node-tar + writeFileSync", async () => {
    const buffer = await createNodeTarBuffer(manyFilesDir, Object.keys(manyFilesEntries), true);
    writeFileSync(join(writeDirNodeTar, `archive-${writeCounter++}.tar.gz`), buffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.write", async () => {
      await Bun.Archive.write(join(writeDirBun, `archive-${writeCounter++}.tar.gz`), manyFilesEntries, "gzip");
    });
  }
});

// ============================================================================
// Get files array from archive (files() method) benchmarks
// ============================================================================

// Helper to get files array from node-tar (reads all entries into memory)
async function getFilesArrayNodeTar(buffer) {
  return new Promise((resolve, reject) => {
    const files = new Map();
    let pending = 0;
    let closed = false;

    const maybeResolve = () => {
      if (closed && pending === 0) {
        resolve(files);
      }
    };

    const unpack = new Unpack({
      onReadEntry: entry => {
        if (entry.type === "File") {
          pending++;
          const chunks = [];
          entry.on("data", chunk => chunks.push(chunk));
          entry.on("end", () => {
            const content = Buffer.concat(chunks);
            // Create a File-like object similar to Bun.Archive.files()
            files.set(entry.path, new Blob([content]));
            pending--;
            maybeResolve();
          });
        }
        entry.resume(); // Drain the entry
      },
    });
    unpack.on("close", () => {
      closed = true;
      maybeResolve();
    });
    unpack.on("error", reject);
    unpack.end(buffer);
  });
}

group("files() - get all files as Map (3 small files)", () => {
  bench("node-tar", async () => {
    await getFilesArrayNodeTar(smallTarBuffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.files()", async () => {
      await Bun.Archive.from(smallBunArchive).files();
    });
  }
});

group("files() - get all files as Map (3 x 100KB files)", () => {
  bench("node-tar", async () => {
    await getFilesArrayNodeTar(largeTarBuffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.files()", async () => {
      await Bun.Archive.from(largeBunArchive).files();
    });
  }
});

group("files() - get all files as Map (100 small files)", () => {
  bench("node-tar", async () => {
    await getFilesArrayNodeTar(manyFilesTarBuffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.files()", async () => {
      await Bun.Archive.from(manyFilesBunArchive).files();
    });
  }
});

group("files() - get all files as Map from .tar.gz (3 small files)", () => {
  bench("node-tar", async () => {
    await getFilesArrayNodeTar(smallTarGzBuffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.files()", async () => {
      await Bun.Archive.from(smallBunArchiveGz).files();
    });
  }
});

group("files() - get all files as Map from .tar.gz (100 small files)", () => {
  bench("node-tar", async () => {
    await getFilesArrayNodeTar(manyFilesTarGzBuffer);
  });

  if (hasBunArchive) {
    bench("Bun.Archive.files()", async () => {
      await Bun.Archive.from(manyFilesBunArchiveGz).files();
    });
  }
});

await run();

// Cleanup
rmSync(setupDir, { recursive: true, force: true });
rmSync(extractDirNodeTar, { recursive: true, force: true });
rmSync(extractDirBun, { recursive: true, force: true });
rmSync(writeDirNodeTar, { recursive: true, force: true });
rmSync(writeDirBun, { recursive: true, force: true });
