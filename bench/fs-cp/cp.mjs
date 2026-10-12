// Recursive fs.cp / fs.cpSync benchmark.
//
//   bun cp.mjs
//   node cp.mjs
//
// The "regular files only" trees are eligible for the whole-tree clonefile()
// fast path on macOS; the trees containing a symlink always go through the
// node-ported walker.
import { cpSync, mkdirSync, promises, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "../runner.mjs";

const root = join(tmpdir(), `bench-fs-cp-${process.pid}`);
rmSync(root, { recursive: true, force: true });

const DIRS = 16;
const FILES_PER_DIR = 16;
const data = Buffer.alloc(4096, "a");

function makeTree(src, { withSymlink = false } = {}) {
  for (let d = 0; d < DIRS; d++) {
    const dir = join(src, `dir-${d}`);
    mkdirSync(dir, { recursive: true });
    for (let f = 0; f < FILES_PER_DIR; f++) {
      writeFileSync(join(dir, `file-${f}.txt`), data);
    }
  }
  if (withSymlink) {
    symlinkSync(join("dir-0", "file-0.txt"), join(src, "link"));
  }
}

const plainSrc = join(root, "plain-src");
makeTree(plainSrc);
const symlinkSrc = join(root, "symlink-src");
makeTree(symlinkSrc, { withSymlink: true });

const destRoot = join(root, "dest");
mkdirSync(destRoot, { recursive: true });
let destCount = 0;

// Each copy goes to a brand-new destination (an existing destination switches
// fs.cp into its merge semantics, which is a different operation). The
// computed parameter clears out previously created destinations without
// counting towards the measured time.
function recursiveCopyBench(label, copyOne) {
  bench(label, function* () {
    yield {
      [0]() {
        rmSync(destRoot, { recursive: true, force: true });
        mkdirSync(destRoot, { recursive: true });
        return destRoot;
      },
      bench(base) {
        return copyOne(join(base, `d${destCount++}`));
      },
    };
  });
}

const totalFiles = DIRS * FILES_PER_DIR;
recursiveCopyBench(`cpSync recursive (${totalFiles} files, regular files only)`, dest =>
  cpSync(plainSrc, dest, { recursive: true }),
);
recursiveCopyBench(`cpSync recursive (${totalFiles} files, tree contains a symlink)`, dest =>
  cpSync(symlinkSrc, dest, { recursive: true }),
);
recursiveCopyBench(`fs.promises.cp recursive (${totalFiles} files, regular files only)`, dest =>
  promises.cp(plainSrc, dest, { recursive: true }),
);
recursiveCopyBench(`fs.promises.cp recursive (${totalFiles} files, tree contains a symlink)`, dest =>
  promises.cp(symlinkSrc, dest, { recursive: true }),
);

try {
  await run();
} finally {
  rmSync(root, { recursive: true, force: true });
}
