/**
 * Builds and runs the tests of the C++ headers, once with assertions and sanitizers and once as they ship.
 *
 *   bun src/engine/embed/tests/run.ts [--only=checked|optimized] [part of a test's name]
 */

import { $, Glob } from "bun";
import { mkdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { unusedFeatures } from "../../../../scripts/build/deps/simdutf.ts";

const { values, positionals } = parseArgs({ options: { only: { type: "string" } }, allowPositionals: true });

const embed = resolve(import.meta.dir, "..");
const root = resolve(embed, "../../..");
const compiler = process.env.CXX ?? "clang++";
const host = (await $`rustc -vV`.cwd(root).text()).match(/^host: (.+)$/m)![1];

const generated = join(root, "target", "embed-tests-headers");
mkdirSync(generated, { recursive: true });
await $`${process.execPath} ${join(root, "src/codegen/generate-engine-headers.ts")} ${generated}`;

const sources = ["tests/*.cpp", "cpp/*.cpp"].flatMap(pattern =>
  [...new Glob(pattern).scanSync({ cwd: embed, absolute: true })].sort(),
);
const flags = [
  ..."-std=gnu++23 -g -fno-exceptions -fno-rtti -fno-omit-frame-pointer -fno-c++-static-destructors".split(" "),
  ..."-Wall -Wextra -Werror -Wno-unused-parameter -Wthread-safety".split(" "),
  ..."-Wno-invalid-offsetof -Wno-unused-private-field -Wno-missing-designated-field-initializers".split(" "),
  `-I${generated}`,
  ...unusedFeatures.map(feature => `-D${feature}=0`),
  ...(process.arch === "x64" ? ["-march=nehalem"] : []),
  ...[join(embed, "include"), join(root, "vendor/mimalloc/include"), join(root, "vendor/simdutf/include")].map(
    directory => `-I${directory}`,
  ),
];
const libraries =
  process.platform === "darwin" ? ["-licucore"] : ["-fuse-ld=lld", "-licui18n", "-licuuc", "-licudata", "-ldl"];

const configurations = {
  checked: { cxx: ["-O1", "-fsanitize=address,undefined", "-fno-sanitize-recover=all"], rust: "--cfg=bun_asan" },
  optimized: { cxx: ["-O2", "-DNDEBUG"], rust: "" },
};

const modified = (path: string) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;
const headers = new Glob("**/*.h").scanSync({ cwd: embed, absolute: true });
const sharedInputsModified = Math.max(modified(import.meta.path), ...Array.from(headers, modified));

async function run(command: $.ShellPromise) {
  const { exitCode } = await command.nothrow();
  if (exitCode) process.exit(exitCode);
}

for (const [name, { cxx, rust }] of Object.entries(configurations)) {
  if (values.only && values.only !== name) continue;
  const directory = join(root, "target", `embed-tests-${name}`);
  mkdirSync(directory, { recursive: true });

  const objectOf = (source: string) => join(directory, `${basename(dirname(source))}-${basename(source)}.o`);
  const stale = sources.filter(source => modified(objectOf(source)) < Math.max(modified(source), sharedInputsModified));
  const compileStale = async () => {
    for (let source; (source = stale.pop());) {
      await run($`${compiler} ${flags} ${cxx} -c ${source} -o ${objectOf(source)}`);
    }
  };
  const library =
    $`cargo build -q -p bun_engine_embed --example native_tests --target ${host} --target-dir ${directory}`
      .cwd(root)
      .env({ ...process.env, RUSTFLAGS: rust });
  await Promise.all([run(library), ...Array.from({ length: 6 }, compileStale)]);

  const program = join(directory, "tests");
  const archive = join(directory, host, "debug/examples/libnative_tests.a");
  const deadStrip = process.platform === "darwin" ? "-Wl,-dead_strip" : "-Wl,--gc-sections";
  await run($`${compiler} ${cxx} ${sources.map(objectOf)} ${archive} ${libraries} ${deadStrip} -o ${program}`);

  console.log(`${name}:`);
  await run($`${program} ${positionals}`);
}
