// Writes src/runtime/cli/typescript_libs.bin: TypeScript's `lib.*.d.ts` files, which `bun check` has built in.
//
//   bun scripts/update-typescript-libs.ts [directory of the lib.*.d.ts files]
//
// Without an argument, they are those of the `typescript7` package that test/package.json installs. They have to be of
// the version of typescript-go that the type checker is a port of. test/cli/check/check.test.ts compares them.
//
// The format is described in src/runtime/cli/typescript_libs.rs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { constants, zstdCompressSync } from "node:zlib";

function installed() {
  const test = join(import.meta.dir, "..", "test");
  const paths = [dirname(require.resolve("typescript7/package.json", { paths: [test] }))];
  const name = `@typescript/typescript-${process.platform}-${process.arch}`;
  return join(dirname(require.resolve(`${name}/package.json`, { paths })), "lib");
}

const from = process.argv[2] ?? installed();
const nameLength = 39;
const recordLength = 1 + nameLength + 4 + 4 + 4;

// Two of the files are the dictionaries of the others, which repeat much of them: lib.webworker.d.ts is 97 KB by
// itself and 7 KB after lib.dom.d.ts. A program that needs one of the others nearly always needs its dictionary too.
// A trained dictionary saves 4%, these save 32%. The numbers are those of `dictionary` in typescript_libs.rs.
const dictionaries = ["lib.es5.d.ts", "lib.dom.d.ts"];
const dictionaryOf = (name: string) =>
  dictionaries.includes(name) ? 0 : /^lib\.(dom|webworker|scripthost)\./.test(name) ? 2 : 1;

// By bytes, which is how they are searched. The names are ASCII.
const names = readdirSync(from)
  .filter(name => /^lib(\.[a-z0-9]+)*\.d\.ts$/.test(name))
  .sort();
const text = (name: string) => readFileSync(join(from, name));
const frames = names.map(name => {
  const dictionary = dictionaryOf(name);
  return zstdCompressSync(text(name), {
    dictionary: dictionary ? text(dictionaries[dictionary - 1]) : undefined,
    pledgedSrcSize: text(name).length,
    params: { [constants.ZSTD_c_compressionLevel]: 19, [constants.ZSTD_c_contentSizeFlag]: 1 },
  });
});

const header = Buffer.alloc(4 + names.length * recordLength);
header.writeUInt32LE(names.length, 0);
let offset = header.length;
for (const [i, name] of names.entries()) {
  if (name.length > nameLength) throw new Error(`${name} is longer than ${nameLength} bytes`);
  const record = 4 + i * recordLength;
  header.writeUInt8(name.length, record);
  header.write(name, record + 1, "latin1");
  header.writeUInt32LE(offset, record + 1 + nameLength);
  header.writeUInt32LE(frames[i].length, record + 1 + nameLength + 4);
  header.writeUInt32LE(dictionaryOf(name), record + 1 + nameLength + 8);
  offset += frames[i].length;
}

const to = join(import.meta.dir, "..", "src", "runtime", "cli", "typescript_libs.bin");
writeFileSync(to, Buffer.concat([header, ...frames]));
console.log(`${names.length} files from ${from}, ${offset} bytes`);
