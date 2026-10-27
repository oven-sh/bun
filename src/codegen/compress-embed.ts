// Writes the zstd-compressed twin of an asset that release builds embed with
// `bun_zstd::embed_compressed!` (inflated on first use; only for assets never
// touched while running user code, e.g. the shell completion scripts).
// Several inputs go into one frame, with a NUL byte between them.
//
// usage: bun compress-embed.ts <output.zst> <input>...
import { mkdirSync, readFileSync } from "fs";
import { dirname } from "path";
import { constants, zstdCompressSync } from "zlib";
import { writeIfNotChangedBinary } from "./helpers.ts";

const [output, ...inputs] = process.argv.slice(2);
if (!output || inputs.length === 0) {
  console.error("usage: compress-embed.ts <output.zst> <input>...");
  process.exit(1);
}
mkdirSync(dirname(output), { recursive: true });
const files = inputs.map(input => readFileSync(input));
const bytes = Buffer.concat(files.flatMap((file, i) => (i === 0 ? [file] : [Buffer.of(0), file])));
writeIfNotChangedBinary(output, zstdCompressSync(bytes, { params: { [constants.ZSTD_c_compressionLevel]: 19 } }));
