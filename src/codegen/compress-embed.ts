// Writes the zstd-compressed twin of an asset that release builds embed with
// `bun_zstd::embed_compressed!` (inflated on first use; only for assets never
// touched while running user code, e.g. the shell completion scripts).
//
// usage: bun compress-embed.ts <input> <output.zst>
import { mkdirSync, readFileSync } from "fs";
import { dirname } from "path";
import { constants, zstdCompressSync } from "zlib";
import { writeIfNotChangedBinary } from "./helpers.ts";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: compress-embed.ts <input> <output.zst>");
  process.exit(1);
}
mkdirSync(dirname(output), { recursive: true });
const bytes = readFileSync(input);
writeIfNotChangedBinary(output, zstdCompressSync(bytes, { params: { [constants.ZSTD_c_compressionLevel]: 19 } }));
