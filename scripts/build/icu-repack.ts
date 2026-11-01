/**
 * ICU's data (build-time CLI, one ninja edge of deps/icu.ts):
 *
 *   icudt<NN>l.dat, as the ICU release tarball has it
 *     │  1. filter  drop the items bun never reaches
 *     │  2. guard   fail if the list of rbnf items to keep went stale
 *     │  3. repack  a zstd frame an item, with a trained dictionary; the items of --keep-raw stay as they are
 *     ▼
 *   <out>/icudt<NN>l.dat   the repacked package
 *   <out>/icudt.zstdict    the dictionary
 *   <out>/icudata.S        `.incbin`s both as icudt<NN>_dat, bun_icu_zstd_dict and bun_icu_zstd_dict_size
 *
 * What oven-sh/WebKit's Dockerfiles and icu/compress-data.ts do for a prebuilt WebKit, without ICU's `icupkg`, which is
 * some 450 sources to compile for the machine that builds. ICU's udata.cpp reaches a compressed item through the weak
 * bun_icu_maybe_decompress (icu/udata-decompress-hook.patch), which src/jsc/bindings/bun_icu_decompress.cpp defines.
 *
 * The package is written here, and read with the reader of the trimmable link (trim/icu-data.ts). Both are checked: what
 * is read, written again, has to be the input byte for byte.
 *
 *   icu-repack.ts --zstd <exe> --in <icudtNNl.dat> --keep-raw <keep-raw.txt> --cover <k=N,d=N|search> --out <dir>
 *               [--obj-format elf|coff]
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BuildError } from "./error.ts";
import { writeIfChanged } from "./fs.ts";
import { itemsOf } from "./trim/icu-data.ts";

/**
 * Items bun never loads: charset converters and their aliases (TextDecoder is not ICU's; UCONFIG_NO_LEGACY_CONVERSION),
 * StringPrep profiles, confusables, transliterators, the names of characters, and the rules of rule-based number
 * formats, except those ICU reaches by itself from numberingSystems.res (assertRbnfKeepList).
 */
const REMOVE = /\.(cnv|spp|cfu)$|^cnvalias\.icu$|^translit\/|^rbnf\/|^unames\.icu$/;
const RBNF_KEEP = new Set(["root", "res_index", "ja", "zh", "zh_Hant"]);

export function isLoaded(item: string): boolean {
  return !REMOVE.test(item) || RBNF_KEEP.has(/^rbnf\/(.+)\.res$/.exec(item)?.[1] ?? "");
}

const ZSTD_LEVEL = 19;
const DICT_SIZE = 128 * 1024;
/** Below this an item is not worth a frame header. */
const MIN_COMPRESS_BYTES = 64;
const MIN_SAVINGS_BYTES = 4;

export interface Item {
  /** Without the prefix of the table of contents: "curr/de.res". */
  name: string;
  body: Buffer;
}

export interface Package {
  /** ucmndata.h DataHeader, copied as it is. */
  header: Buffer;
  /** "icudt79l": every name in the table of contents is "<prefix>/<name>". */
  prefix: string;
  items: Item[];
}

// After the DataHeader (ucmndata.h UDataOffsetTOC), offsets counted from the start of the table:
//   u32  count
//   { u32 nameOffset; u32 dataOffset; }[count]
//   char names[]     NUL-terminated, in the table's order
//   item bodies[]    each 16-byte aligned, the gaps filled with 0xaa

export function readPackage(raw: Buffer): Package {
  const sizes = itemsOf(raw);
  const toc = raw.readUInt16LE(0);
  const firstName = toc + raw.readUInt32LE(toc + 4);
  const prefix = raw.toString("latin1", firstName, raw.indexOf("/", firstName));
  if (!/^icudt\d+l$/.test(prefix))
    throw new BuildError(`The names of ICU's data start with '${prefix}', not icudt<NN>l`);
  let at = toc + raw.readUInt32LE(toc + 8);
  // With the padding behind it, which is not told apart from the item: ICU takes the same range for its length.
  const items = sizes.map(({ name, size }) => ({ name, body: raw.subarray(at, (at += size)) }));
  return { header: raw.subarray(0, toc), prefix, items };
}

export function writePackage({ header, prefix }: Package, items: readonly Item[]): Buffer {
  const toc = header.length;
  const tableBytes = 4 + items.length * 8;
  const padding = (at: number): Buffer => Buffer.alloc((16 - (at % 16)) % 16, 0xaa);
  const table = Buffer.alloc(tableBytes);
  table.writeUInt32LE(items.length, 0);

  const names: Buffer[] = [];
  let offset = tableBytes;
  items.forEach(({ name }, i) => {
    table.writeUInt32LE(offset, 4 + i * 8);
    names.push(Buffer.from(`${prefix}/${name}\0`, "latin1"));
    offset += names.at(-1)!.length;
  });

  const bodies: Buffer[] = [];
  items.forEach(({ body }, i) => {
    const pad = padding(toc + offset);
    table.writeUInt32LE(offset + pad.length, 8 + i * 8);
    bodies.push(pad, body);
    offset += pad.length + body.length;
  });
  return Buffer.concat([header, table, ...names, ...bodies]);
}

/**
 * ICU reaches rbnf/ by itself: numberingSystems.res has numbering systems whose rules are "<locale>/SpelloutRules/...",
 * and date patterns name those systems. One outside RBNF_KEEP would fail when a program formats with it, not here.
 */
export function assertRbnfKeepList(items: readonly Item[]): void {
  const numberingSystems = items.find(item => item.name === "numberingSystems.res");
  if (numberingSystems === undefined) throw new BuildError("icu-repack: the package has no numberingSystems.res");
  // What `strings -el` prints: runs of four or more printable characters.
  const strings = numberingSystems.body.toString("utf16le").match(/[\x20-\x7e]{4,}/g) ?? [];
  const locales = new Set(strings.flatMap(s => /^([A-Za-z_]+)\//.exec(s)?.[1] ?? []));
  const missing = [...locales].filter(locale => !RBNF_KEEP.has(locale));
  if (missing.length > 0) {
    throw new BuildError(`icu-repack: numberingSystems.res also reaches the rbnf rules of ${missing.join(", ")}`, {
      file: import.meta.filename,
      hint: "Add them to RBNF_KEEP",
    });
  }
}

/** The lines of icu/keep-raw.txt. `*` stands for part of one path segment. */
export function keepRawPatterns(lines: string): RegExp[] {
  return lines
    .split("\n")
    .map(line => line.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map(glob => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`));
}

function main(): void {
  const { values: opts } = parseArgs({
    options: {
      zstd: { type: "string" },
      in: { type: "string" },
      "keep-raw": { type: "string" },
      cover: { type: "string" },
      out: { type: "string" },
      "obj-format": { type: "string", default: "elf" },
    },
  });
  if (!opts.zstd || !opts.in || !opts["keep-raw"] || !opts.cover || !opts.out) {
    throw new BuildError(
      "usage: icu-repack.ts --zstd <exe> --in <icudtNNl.dat> --keep-raw <file> --cover <k=N,d=N|search> --out <dir>",
    );
  }
  const { zstd, in: input, out } = opts;
  const coff = opts["obj-format"] === "coff";
  if (!coff && opts["obj-format"] !== "elf") throw new BuildError(`--obj-format is elf or coff`);
  const run = (args: string[]): string => {
    const r = spawnSync(zstd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
    if (r.error) throw new BuildError(`icu-repack: could not run ${zstd}`, { cause: r.error });
    if (r.status !== 0) {
      throw new BuildError(`icu-repack: ${zstd} ${args.join(" ")} exited with ${r.status}\n${r.stderr}`);
    }
    return r.stderr;
  };

  const raw = readFileSync(input);
  const pkg = readPackage(raw);
  if (Buffer.compare(raw, writePackage(pkg, pkg.items)) !== 0) {
    throw new BuildError(`icu-repack: ${input}, read and written again, is not what it was`, {
      hint: "This ICU lays out its package in another way than ucmndata.h's UDataOffsetTOC",
    });
  }

  const items = pkg.items.filter(({ name }) => isLoaded(name));
  assertRbnfKeepList(items);

  const patterns = keepRawPatterns(readFileSync(opts["keep-raw"], "utf8"));
  const compressible = items.filter(
    ({ name, body }) => body.length >= MIN_COMPRESS_BYTES && !patterns.some(pattern => pattern.test(name)),
  );

  const work = join(out, "work");
  rmSync(work, { recursive: true, force: true });
  const rawDir = join(work, "raw");
  const frameDir = join(work, "frames");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(frameDir);
  const flat = (name: string): string => name.replaceAll("/", "_");
  for (const { name, body } of compressible) writeFileSync(join(rawDir, flat(name)), body);

  // Trained on what will be compressed alone: the rest would take room in the dictionary. The cover algorithm gives a
  // better dictionary for these files than the default.
  const trained = join(work, "icudt.zstdict");
  const train = ["--train", "-r", rawDir, "-o", trained, `--maxdict=${DICT_SIZE}`];
  if (opts.cover === "search") {
    const found = run(["-v", "-T0", "--train-cover", ...train]).split(/[\r\n]+/);
    const last = (name: string): string => found.filter(line => line.startsWith(name + "=")).at(-1)!;
    console.log(`zstd's search settled on ${last("k")},${last("d")}`);
  } else {
    run(["-q", `--train-cover=${opts.cover}`, ...train]);
  }
  const dictionary = join(out, "icudt.zstdict");
  writeIfChanged(dictionary, readFileSync(trained));

  // From files, so that each frame says how long its content is. No checksum (the data is read-only in the executable)
  // and no dictionary ID (there is one dictionary).
  run([
    ...["-q", "-f", "--no-check", "--no-dictID", `-${ZSTD_LEVEL}`, "-D", trained],
    ...["-r", rawDir, "--output-dir-flat", frameDir],
  ]);

  const frames = new Map(compressible.map(({ name }) => [name, readFileSync(join(frameDir, flat(name) + ".zst"))]));
  let compressed = 0;
  const repacked = items.map(({ name, body }) => {
    const frame = frames.get(name);
    if (frame === undefined || frame.length + MIN_SAVINGS_BYTES >= body.length) return { name, body };
    compressed++;
    return { name, body: frame };
  });
  const data = join(out, `${pkg.prefix}.dat`);
  writeIfChanged(data, writePackage(pkg, repacked));

  const symbol = pkg.prefix.slice(0, -1) + "_dat";
  // COFF symbols have no type.
  const type = (name: string): string[] => (coff ? [] : [`.type ${name}, @object`]);
  writeIfChanged(
    join(out, "icudata.S"),
    [
      coff ? ".section .rdata" : ".section .rodata",
      ".balign 16",
      `.global ${symbol}`,
      ...type(symbol),
      `${symbol}:`,
      `.incbin "${data.replaceAll("\\", "/")}"`,
      "",
      ".balign 16",
      ".global bun_icu_zstd_dict",
      ...type("bun_icu_zstd_dict"),
      "bun_icu_zstd_dict:",
      `.incbin "${dictionary.replaceAll("\\", "/")}"`,
      ".Ldict_end:",
      "",
      ".balign 4",
      ".global bun_icu_zstd_dict_size",
      ...type("bun_icu_zstd_dict_size"),
      "bun_icu_zstd_dict_size:",
      ".long .Ldict_end - bun_icu_zstd_dict",
      ...(coff ? [] : ['.section .note.GNU-stack,"",@progbits']),
      "",
    ].join("\n"),
  );

  const size = (list: readonly Item[]): number => list.reduce((sum, { body }) => sum + body.length, 0);
  console.log(
    `${items.length} items (${pkg.items.length - items.length} removed), ${compressed} compressed: ` +
      `${size(items)} → ${size(repacked)} bytes`,
  );
  rmSync(work, { recursive: true, force: true });
}

if (process.argv[1] === import.meta.filename) {
  try {
    main();
  } catch (err) {
    if (!(err instanceof BuildError)) throw err;
    process.stderr.write(err.format());
    process.exit(1);
  }
}
