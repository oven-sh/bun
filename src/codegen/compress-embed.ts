// Writes the zstd-compressed twin of an asset that release builds embed with
// `bun_zstd::embed_compressed!` (inflated on first use; only for assets never
// touched while running user code, e.g. the shell completion scripts).
//
// usage: bun compress-embed.ts <input> <output.zst>
import { mkdirSync } from "fs";
import { dirname } from "path";
import { writeIfNotChangedBinary } from "./helpers";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: compress-embed.ts <input> <output.zst>");
  process.exit(1);
}
mkdirSync(dirname(output), { recursive: true });
const bytes = await Bun.file(input).bytes();
writeIfNotChangedBinary(output, Buffer.from(Bun.zstdCompressSync(bytes, { level: 19 })));
