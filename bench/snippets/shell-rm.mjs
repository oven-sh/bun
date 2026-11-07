// Bun Shell `rm` with one operand and with many operands.
//
//   bun shell-rm.mjs
//
// Each run removes a new tree. The tree is made in the part of the run that
// is not timed, below os.tmpdir(). Set TMPDIR to measure another file system.
import { $ } from "bun";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, run } from "../runner.mjs";

const root = join(tmpdir(), `bench-shell-rm-${process.pid}`);
rmSync(root, { recursive: true, force: true });
let trees = 0;
// The directories of the runs that are done. mitata can make the trees of many runs before it times them.
const done = [];

// `count` files of `bytes` bytes in `dir`. Returns their names.
function files(dir, count, bytes = 0) {
  mkdirSync(dir, { recursive: true });
  const data = Buffer.alloc(bytes, 120);
  const names = [];
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `f${i}`), data);
    names.push(`f${i}`);
  }
  return names;
}

// `directories` directories below `dir`, each with `subdirectories` directories of `count` files,
// or with `count` files of its own when `subdirectories` is 0. Returns their names.
function directories(dir, directories, subdirectories, count, bytes = 0) {
  const names = [];
  for (let d = 0; d < directories; d++) {
    if (subdirectories === 0) files(join(dir, `d${d}`), count, bytes);
    for (let s = 0; s < subdirectories; s++) files(join(dir, `d${d}`, `s${s}`), count, bytes);
    names.push(`d${d}`);
  }
  return names;
}

// The names of 5,000 files in 500 directories below `dir`.
function filesInDirectories(dir, bytes = 0) {
  return directories(dir, 500, 0, 10, bytes).flatMap(d => Array.from({ length: 10 }, (_, i) => `${d}/f${i}`));
}

// `make(dir)` makes the tree in `dir` and returns the operands of the line.
function rm(label, flags, make) {
  bench(label, function* () {
    yield {
      [0]() {
        // A line can leave a part of its tree behind.
        for (const dir of done.splice(0)) rmSync(dir, { recursive: true, force: true });
        const dir = join(root, String(trees++));
        mkdirSync(dir, { recursive: true });
        return { dir, operands: make(dir) };
      },
      async bench({ dir, operands }) {
        await $`rm ${flags} ${operands}`.cwd(dir).quiet();
        done.push(dir);
      },
    };
  });
}

// One operand.
rm("rm f", [], dir => files(dir, 1));
// 200 packages of 3 directories with 4 files each, as one operand.
rm("rm -rf nm", ["-rf"], dir => {
  directories(join(dir, "nm"), 200, 3, 4);
  return ["nm"];
});
// 160 directories of 200 files each, as one operand.
rm("rm -rf t", ["-rf"], dir => {
  directories(join(dir, "t"), 160, 0, 200);
  return ["t"];
});

// Two or three small directory operands, as in `rm -rf dist build`.
rm("rm -rf a b (2 empty directories)", ["-rf"], dir => directories(dir, 2, 0, 0));
rm("rm -rf a b (2 x 10 files)", ["-rf"], dir => directories(dir, 2, 0, 10));
rm("rm -rf a b (2 x 100 files)", ["-rf"], dir => directories(dir, 2, 0, 100));
rm("rm -rf a b c (3 x 10 files)", ["-rf"], dir => directories(dir, 3, 0, 10));

// Many file operands.
// 5,000 files of one directory.
rm("rm f*", [], dir => files(dir, 5000));
rm("rm -rf f*", ["-rf"], dir => files(dir, 5000));
rm("rm -v f*", ["-v"], dir => files(dir, 5000));
rm("rm f* (4 KiB each)", [], dir => files(dir, 5000, 4096));
rm("rm f* (16 KiB each)", [], dir => files(dir, 5000, 16384));
// 5,000 files in 500 directories.
rm("rm d*/f*", [], dir => filesInDirectories(dir));
rm("rm d*/f* (4 KiB each)", [], dir => filesInDirectories(dir, 4096));
rm("rm d*/f* (16 KiB each)", [], dir => filesInDirectories(dir, 16384));

// Many directory operands without subdirectories.
rm("rm -r d* (200 x 50 files)", ["-r"], dir => directories(dir, 200, 0, 50));
rm("rm -r d* (200 x 50 files of 4 KiB)", ["-r"], dir => directories(dir, 200, 0, 50, 4096));
rm("rm -r d* (200 x 50 files of 16 KiB)", ["-r"], dir => directories(dir, 200, 0, 50, 16384));
rm("rm -r d* (8 x 1,250 files)", ["-r"], dir => directories(dir, 8, 0, 1250));
rm("rm -rf a b c (3 x 2,000 files)", ["-rf"], dir => directories(dir, 3, 0, 2000));
// Spelled with a trailing separator, and as absolute paths.
rm("rm -r d*/ (200 x 50 files)", ["-r"], dir => directories(dir, 200, 0, 50).map(name => `${name}/`));
rm("rm -r /abs/d* (200 x 50 files)", ["-r"], dir => directories(dir, 200, 0, 50).map(name => join(dir, name)));
// Two dirnames in turn.
rm("rm -r x/d0 y/d0 x/d1 .. (200 x 50 files)", ["-r"], dir => {
  directories(join(dir, "x"), 100, 0, 50);
  return directories(join(dir, "y"), 100, 0, 50).flatMap(name => [`x/${name}`, `y/${name}`]);
});
// Directories, then files.
rm("rm -rf d* f* (200 x 50 files, 2,000 files)", ["-rf"], dir => [
  ...directories(dir, 200, 0, 50),
  ...files(dir, 2000),
]);
// With -v.
rm("rm -rv d* (5,000 x 1 file)", ["-rv"], dir => directories(dir, 5000, 0, 1));

// Many directory operands with subdirectories.
// The 200 packages of `rm -rf nm` as 200 operands.
rm("rm -rf nm/*", ["-rf"], dir => directories(join(dir, "nm"), 200, 3, 4).map(name => `nm/${name}`));
// 100 operands of 4 directories with 10 files each.
rm("rm -rf packages/*/dist", ["-rf"], dir =>
  Array.from({ length: 100 }, (_, i) => {
    directories(join(dir, "packages", `p${i}`, "dist"), 4, 0, 10);
    return `packages/p${i}/dist`;
  }),
);
// 8 operands of 20 directories with 200 files each.
rm("rm -rf d* (8 x 20 x 200)", ["-rf"], dir => directories(dir, 8, 20, 200));

try {
  await run();
} finally {
  rmSync(root, { recursive: true, force: true });
}
