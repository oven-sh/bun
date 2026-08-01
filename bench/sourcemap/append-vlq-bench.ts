// Microbench for InternalSourceMap.append_vlq_to() (re-encoding the internal
// blob back to a standard VLQ "mappings" string). Compare against a baseline
// build by running:
//
//   bun run build:release bench/sourcemap/append-vlq-bench.ts
//
// This path is hit by the inspector inline-sourcemap emit and by
// ParsedSourceMap.write_vlqs / Chunk.print_source_map_contents_from_internal,
// not by stack remapping (see internal-sourcemap-bench.ts for that).

// @ts-expect-error bun:internal-for-testing has no .d.ts
import { internalSourceMap } from "bun:internal-for-testing";

const ITER = 50;
const flag = process.argv[2] ?? "bench";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeVLQ(value: number): string {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}

// ~200k mappings across 50k generated lines: exercises the per-mapping encode
// and the upfront capacity reservation.
function buildDense(): string {
  const parts: string[] = [];
  let prevGenCol = 0;
  let prevOrigLine = 0;
  let prevOrigCol = 0;
  for (let line = 0; line < 50_000; line++) {
    let col = 0;
    for (let k = 0; k < 4; k++) {
      col += 3 + k;
      const ocol = prevOrigCol + 3 + k;
      if (k > 0) parts.push(",");
      parts.push(
        encodeVLQ(col - prevGenCol) + encodeVLQ(0) + encodeVLQ(line - prevOrigLine) + encodeVLQ(ocol - prevOrigCol),
      );
      prevGenCol = col;
      prevOrigLine = line;
      prevOrigCol = ocol;
    }
    parts.push(";");
    prevGenCol = 0;
  }
  return parts.join("");
}

// Two mappings separated by a 5M-line run of ';': exercises the batched
// line-separator write.
function buildGap(): string {
  return "AAAA" + Buffer.alloc(5_000_000, ";").toString() + "AAAA";
}

function run(name: string, blob: Uint8Array) {
  // Warm.
  let out = internalSourceMap.toVLQ(blob);
  for (let i = 0; i < 4; i++) out = internalSourceMap.toVLQ(blob);

  const t0 = performance.now();
  for (let i = 0; i < ITER; i++) out = internalSourceMap.toVLQ(blob);
  const t1 = performance.now();
  console.log(
    `[${flag}] ${name.padEnd(30)} ${((t1 - t0) / ITER).toFixed(3)} ms/op  (${out.length} bytes, ${ITER} iters)`,
  );
}

run("200k mappings, 50k lines:", internalSourceMap.fromVLQ(buildDense()));
run("2 mappings, 5M-line gap:", internalSourceMap.fromVLQ(buildGap()));
