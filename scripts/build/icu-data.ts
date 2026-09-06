/**
 * ICU data pipeline (build-time CLI, invoked by one ninja edge from deps/icu.ts):
 *
 *   icudt<NN>l.dat (as shipped in the ICU release tarball)
 *     │  1. filter  — drop items bun never reaches (icupkg -r)
 *     │  2. guard   — fail if the rbnf keep-list went stale
 *     │  3. repack  — per-item zstd with a trained dictionary; KEEP_RAW
 *     │               items stay uncompressed
 *     ▼
 *   <out>/icudt<NN>l.dat   the repacked package
 *   <out>/icudt.zstdict    the dictionary
 *   <out>/icudata.S        `.incbin`s both, exporting icudt<NN>_dat,
 *                          bun_icu_zstd_dict, bun_icu_zstd_dict_size
 *
 * The .S is assembled by the normal `cc` edge (target flags apply there) and
 * linked with the other ICU objects; ICU's udata.cpp reaches compressed items through the
 * weak bun_icu_maybe_decompress hook (patches/icu/udata-decompress-hook.patch,
 * implemented in src/jsc/bindings/bun_icu_decompress.cpp).
 *
 * Reads items through ICU's own `icupkg` (built for the host by deps/icu.ts)
 * and compresses with the `zstd` CLI; the only hand-rolled binary code is
 * rewriting the package TOC, which is verified by a byte-exact round trip of
 * the unmodified package first.
 *
 *   icu-data.ts --icupkg <exe> --in <icudtNNl.dat> --out <dir> [--obj-format elf|coff]
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { BuildError } from "./error.ts";
import { writeIfChanged } from "./fs.ts";

// ───────────────────────────────────────────────────────────────────────────
// What gets removed from the stock package
// ───────────────────────────────────────────────────────────────────────────

/**
 * Items bun never loads: charset converter tables and aliases (TextCodec is
 * not ICU-backed; UCONFIG_NO_LEGACY_CONVERSION), StringPrep profiles,
 * confusables (uspoof), transliterators, Unicode character names, and the
 * rule-based-number-format rules except the ones ICU itself reaches from
 * numberingSystems.res (checked by assertRbnfKeepList).
 */
const REMOVE = /\.(cnv|spp|cfu)$|^cnvalias\.icu$|^translit\/|^rbnf\/|^unames\.icu$/;
const RBNF_KEEP = new Set(["root", "res_index", "ja", "zh", "zh_Hant"]);
const keepAnyway = (item: string): boolean => {
  const m = /^rbnf\/(.+)\.res$/.exec(item);
  return m !== null && RBNF_KEEP.has(m[1]!);
};

/**
 * Items that stay UNCOMPRESSED because decompressing them on first use would
 * cost too much: the item is large (>~100 KB → ms-scale decode), it is loaded
 * by JSC/VM init, or it is shared by every call into a subsystem (root / pool
 * / DUCET). Everything else is per-item zstd'd and decompressed on first
 * lookup by bun_icu_maybe_decompress. `*` matches within one path segment.
 */
const KEEP_RAW = [
  // Unicode property tries / normalization — JSC init (lexer, regex \p{})
  // and String.normalize / URL IDNA read these.
  "*.icu",
  "*.nrm",
  // Shared string pools — every locale bundle in a tree references its
  // tree's pool; compressing them would add ~100-150 us to the first call of
  // each tree's API regardless of locale.
  "*/pool.res",
  "pool.res",
  // en-locale and root format patterns — Date.toString() and Intl.*("en").
  "root.res",
  "en.res",
  "en_*.res",
  // ko.res is the one locale-pattern file large enough (70 KB) to decode in
  // ~100 us; the next-largest (ff_Adlm, zh, ru) are <40 KB and stay compressed.
  "ko.res",
  // Supplemental tables — touched by Date / Intl.Locale / DateTimeFormat /
  // NumberFormat construction across many locales.
  "supplementalData.res",
  "zoneinfo64.res",
  "metaZones.res",
  "timezoneTypes.res",
  "windowsZones.res",
  "numberingSystems.res",
  "plurals.res",
  "pluralRanges.res",
  "dayPeriods.res",
  "genderList.res",
  "metadata.res",
  "units.res",
  "langInfo.res",
  "keyTypeData.res",
  // Collation: the DUCET root table is opened by every Intl.Collator (573 KB,
  // ~0.8 ms decode); the CJK tailorings are the only per-locale ones >100 KB.
  "coll/ucadata.icu",
  "coll/root.res",
  "coll/zh.res",
  "coll/ko.res",
  "coll/ja.res",
  // Segmentation dictionaries — cjdict alone is 2 MB (~1.9 ms decode).
  "brkitr/*.dict",
].map(g => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`));
const keepRaw = (bare: string): boolean => KEEP_RAW.some(r => r.test(bare));

const ZSTD_LEVEL = 19;
const DICT_SIZE = 128 * 1024;
/** Below this an item isn't worth a frame header. */
const MIN_COMPRESS_BYTES = 64;
const MIN_SAVINGS_BYTES = 4;

// ───────────────────────────────────────────────────────────────────────────

const { values: opts } = parseArgs({
  options: {
    icupkg: { type: "string" },
    in: { type: "string" },
    out: { type: "string" },
    "obj-format": { type: "string", default: "elf" },
  },
});
if (!opts.icupkg || !opts.in || !opts.out) {
  throw new BuildError("usage: icu-data.ts --icupkg <exe> --in <icudtNNl.dat> --out <dir> [--obj-format elf|coff]");
}
const ICUPKG = opts.icupkg;
const IN_DAT = opts.in;
const OUT = opts.out;
const OBJ_FORMAT = opts["obj-format"];
if (OBJ_FORMAT !== "elf" && OBJ_FORMAT !== "coff")
  throw new BuildError(`--obj-format must be elf or coff, got ${OBJ_FORMAT}`);

interface Item {
  /** Bare name as `icupkg -l` reports it, e.g. "curr/de.res". */
  bare: string;
  body: Buffer;
}

/** Verbatim package header — copied byte-for-byte to the output. */
interface Header {
  bytes: Buffer;
  /** TOC name prefix, e.g. "icudt78l" — every TOC entry is "<prefix>/<bare>". */
  tocPrefix: string;
  /** Linker symbol stem, e.g. "icudt78" — what genccode/ICU emit. */
  pkg: string;
}

function run(cmd: readonly string[], what: string): string {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.error) {
    throw new BuildError(`icu-data: failed to spawn ${cmd[0]} (${what})`, {
      cause: r.error,
      ...(cmd[0] === "zstd" && { hint: "Install the zstd CLI (>= 1.5)" }),
    });
  }
  if (r.status !== 0)
    throw new BuildError(`icu-data: ${what} failed (exit ${r.status}): ${cmd.join(" ")}\n${r.stderr}`);
  return r.stdout;
}

// ───────────────────────────────────────────────────────────────────────────
// Read side — delegated to ICU's own icupkg
// ───────────────────────────────────────────────────────────────────────────

function listItems(dat: string): string[] {
  return run([ICUPKG, "-l", dat], "icupkg -l")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Copy the input package's DataHeader verbatim. ICU's header format
 * (ucmndata.h DataHeader) is `[u16 headerSize][u8 0xda][u8 0x27][UDataInfo …]
 * [copyright pad]` — read headerSize and copy that many bytes unchanged.
 */
function readHeader(raw: Buffer, dat: string): Header {
  const headerSize = raw.readUInt16LE(0);
  if (raw[2] !== 0xda || raw[3] !== 0x27) throw new BuildError(`${dat}: not an ICU data file (no 0xda27 magic)`);
  if (raw.toString("latin1", 12, 16) !== "CmnD") throw new BuildError(`${dat}: not a CmnD package`);
  // First TOC name gives the prefix: header | u32 count | {u32,u32}[count] | "<prefix>/..."\0
  const firstName = headerSize + raw.readUInt32LE(headerSize + 4);
  const slash = raw.indexOf(0x2f, firstName);
  const tocPrefix = raw.toString("latin1", firstName, slash);
  if (!/^icudt\d+[lb]$/.test(tocPrefix)) throw new BuildError(`${dat}: unexpected TOC prefix '${tocPrefix}'`);
  return { bytes: Buffer.from(raw.subarray(0, headerSize)), tocPrefix, pkg: tocPrefix.replace(/[lb]$/, "") };
}

// ───────────────────────────────────────────────────────────────────────────
// Write side — the only hand-rolled binary code.
//
// ICU's CmnD package layout after the DataHeader (ucmndata.h UDataOffsetTOC):
//   u32  count
//   { u32 nameOffset; u32 dataOffset; }[count]   // offsets relative to TOC start
//   char names[]                                 // NUL-terminated, in TOC order
//   item bodies[]                                // each 16-byte aligned
// icupkg -a would do this for us, but it validates each item's 0xda27 magic
// and rejects zstd frames.
// ───────────────────────────────────────────────────────────────────────────

function writePackage(header: Header, items: readonly Item[]): Buffer {
  const tocStart = header.bytes.length;
  const tocBytes = 4 + items.length * 8;
  let nameOff = tocBytes;
  const nameOffsets: number[] = [];
  const namePool: Buffer[] = [];
  for (const it of items) {
    nameOffsets.push(nameOff);
    const n = Buffer.from(`${header.tocPrefix}/${it.bare}\0`, "latin1");
    namePool.push(n);
    nameOff += n.length;
  }
  const namesBuf = padTo16(Buffer.concat(namePool), tocStart + tocBytes);
  let dataOff = tocBytes + namesBuf.length;
  const dataOffsets: number[] = [];
  const bodies: Buffer[] = [];
  for (const it of items) {
    const pad = (16 - ((tocStart + dataOff) % 16)) % 16;
    if (pad) {
      bodies.push(Buffer.alloc(pad, 0xaa));
      dataOff += pad;
    }
    dataOffsets.push(dataOff);
    bodies.push(it.body);
    dataOff += it.body.length;
  }
  const toc = Buffer.alloc(tocBytes);
  toc.writeUInt32LE(items.length, 0);
  for (let i = 0; i < items.length; i++) {
    toc.writeUInt32LE(nameOffsets[i]!, 4 + i * 8);
    toc.writeUInt32LE(dataOffsets[i]!, 8 + i * 8);
  }
  return Buffer.concat([header.bytes, toc, namesBuf, ...bodies]);
}

function padTo16(buf: Buffer, absoluteStart: number): Buffer {
  const pad = (16 - ((absoluteStart + buf.length) % 16)) % 16;
  return pad ? Buffer.concat([buf, Buffer.alloc(pad, 0xaa)]) : buf;
}

/** UTF-16LE runs of ≥4 printable chars — what `strings -el` prints. */
function utf16Strings(buf: Buffer): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf.readUInt16LE(i);
    if (c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c);
    else {
      if (cur.length >= 4) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= 4) out.push(cur);
  return out;
}

/**
 * numberingSystems.res is how ICU reaches rbnf/ on its own (algorithmic
 * numbering systems name "<locale>/SpelloutRules/..."). If a future ICU adds
 * one outside RBNF_KEEP, Intl.NumberFormat with that numbering system would
 * fail at runtime instead of here.
 */
function assertRbnfKeepList(itemsDir: string): void {
  const locales = new Set<string>();
  for (const s of utf16Strings(readFileSync(join(itemsDir, "numberingSystems.res")))) {
    const m = /^([A-Za-z_]+)\//.exec(s);
    if (m) locales.add(m[1]!);
  }
  const stale = [...locales].filter(l => !RBNF_KEEP.has(l));
  if (stale.length > 0) {
    throw new BuildError(`icu-data: rbnf keep-list is stale; numberingSystems.res also reaches: ${stale.join(", ")}`, {
      file: import.meta.filename,
      hint: "Add them to RBNF_KEEP",
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────

function main(): void {
  mkdirSync(OUT, { recursive: true });
  const work = join(OUT, "work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  // 1. Filter.
  const all = listItems(IN_DAT);
  const removed = all.filter(i => REMOVE.test(i) && !keepAnyway(i));
  const rmList = join(work, "rm.lst");
  writeFileSync(rmList, removed.join("\n") + "\n");
  const filtered = join(work, basename(IN_DAT));
  run([ICUPKG, "--auto_toc_prefix", "-r", rmList, IN_DAT, filtered], "icupkg -r");

  // Extract every remaining item (raw bodies) with ICU's own unpacker.
  const itemsDir = join(work, "items");
  mkdirSync(itemsDir);
  run([ICUPKG, "-x", "*", "-d", itemsDir, filtered], "icupkg -x");
  const names = listItems(filtered);

  // 2. Guard.
  assertRbnfKeepList(itemsDir);

  // Round-trip invariant: writePackage on the raw items must reproduce the
  // filtered package byte-for-byte, or the TOC layout assumption is wrong
  // for this ICU version and nothing below can be trusted.
  const filteredBytes = readFileSync(filtered);
  const header = readHeader(filteredBytes, filtered);
  const rebuilt = writePackage(
    header,
    names.map(bare => ({ bare, body: readFileSync(join(itemsDir, bare)) })),
  );
  if (Buffer.compare(filteredBytes, rebuilt) !== 0) {
    throw new BuildError(
      `icu-data: TOC round-trip failed for ${filtered} (${filteredBytes.length} vs ${rebuilt.length} bytes) — UDataOffsetTOC layout assumption is wrong for this ICU`,
    );
  }

  // 3. Repack. Train the dictionary only on items that will be compressed —
  // kept-raw items would waste dictionary capacity.
  const trainDir = join(work, "train");
  mkdirSync(trainDir);
  for (const bare of names) {
    if (!keepRaw(bare)) writeFileSync(join(trainDir, bare.replace(/\//g, "_")), readFileSync(join(itemsDir, bare)));
  }
  // Trained into the work dir and copied out only if it changed, like the
  // .dat and .S below, so a rerun that reproduces the same bytes leaves the
  // outputs' mtimes alone (restat) and nothing downstream relinks.
  const dict = join(OUT, "icudt.zstdict");
  const trainedDict = join(work, "icudt.zstdict");
  // --train-cover (exhaustive segment search) beats the default fastcover
  // for this corpus; build-time only.
  run(
    ["zstd", "-q", "--train", "--train-cover", "-r", trainDir, "-o", trainedDict, `--maxdict=${DICT_SIZE}`],
    "zstd --train",
  );
  writeIfChangedBuffer(dict, readFileSync(trainedDict));

  // One zstd invocation for all items (the train dir already holds them under
  // flat names): reads from disk so each frame header carries the content
  // size; no per-frame checksum (data lives in .rodata) or dictID (one dict).
  const zDir = join(work, "z");
  mkdirSync(zDir);
  run(
    [
      "zstd",
      "-q",
      "-f",
      "--no-check",
      "--no-dictID",
      `-${ZSTD_LEVEL}`,
      "-D",
      dict,
      "-r",
      trainDir,
      "--output-dir-flat",
      zDir,
    ],
    "zstd compress",
  );

  let compressed = 0;
  let rawBytes = 0;
  let outBytes = 0;
  const items: Item[] = names.map(bare => {
    const raw = readFileSync(join(itemsDir, bare));
    rawBytes += raw.length;
    let body = raw;
    if (raw.length >= MIN_COMPRESS_BYTES && !keepRaw(bare)) {
      const z = readFileSync(join(zDir, bare.replace(/\//g, "_") + ".zst"));
      if (z.length + MIN_SAVINGS_BYTES < raw.length) {
        body = z;
        compressed++;
      }
    }
    outBytes += body.length;
    return { bare, body };
  });

  const pkg = writePackage(header, items);
  // Sanity: count and first/last names read back from the new TOC.
  const toc = header.bytes.length;
  if (pkg.readUInt32LE(toc) !== names.length) throw new BuildError("icu-data: output TOC count mismatch");
  const outDat = join(OUT, `${header.tocPrefix}.dat`);
  writeIfChangedBuffer(outDat, pkg);

  // The assembly stub. ELF: .rodata + `.type sym, @object`; COFF: .rdata and
  // no .type (COFF symbols carry no object type).
  const coff = OBJ_FORMAT === "coff";
  const type = (sym: string): string[] => (coff ? [] : [`.type ${sym}, @object`]);
  const asm = [
    `/* generated by scripts/build/icu-data.ts — ${names.length} items, ${compressed} zstd-compressed, ${removed.length} removed */`,
    coff ? ".section .rdata" : `.section .rodata`,
    ".balign 16",
    `.global ${header.pkg}_dat`,
    ...type(`${header.pkg}_dat`),
    `${header.pkg}_dat:`,
    `.incbin "${outDat.replaceAll("\\", "/")}"`,
    "",
    ".balign 16",
    ".global bun_icu_zstd_dict",
    ...type("bun_icu_zstd_dict"),
    "bun_icu_zstd_dict:",
    `.incbin "${dict.replaceAll("\\", "/")}"`,
    ".Ldict_end:",
    "",
    ".balign 4",
    ".global bun_icu_zstd_dict_size",
    ...type("bun_icu_zstd_dict_size"),
    "bun_icu_zstd_dict_size:",
    ".long .Ldict_end - bun_icu_zstd_dict",
    ...(coff ? [] : ['.section .note.GNU-stack,"",@progbits']),
    "",
  ].join("\n");
  writeIfChanged(join(OUT, "icudata.S"), asm);

  console.log(
    `${names.length} items (${removed.length} removed): ${compressed} compressed, ` +
      `${rawBytes}→${outBytes} bytes (${((100 * outBytes) / rawBytes).toFixed(0)}%), dict ${readFileSync(dict).length}`,
  );
  rmSync(work, { recursive: true, force: true });
}

function writeIfChangedBuffer(path: string, data: Buffer): void {
  try {
    if (Buffer.compare(readFileSync(path), data) === 0) return;
  } catch {}
  writeFileSync(path, data);
}

try {
  main();
} catch (err) {
  if (err instanceof BuildError) {
    process.stderr.write(err.format());
    process.exit(1);
  }
  throw err;
}
