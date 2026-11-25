// In a hardened build, Rust's arithmetic and the standard library check more than elsewhere, and end the process if they find
// something. src/jsc/bindings/highway_zstd.cpp is compiled with other flags. No other test of zstd runs on such a build.
import { describe, expect, test } from "bun:test";
import { crc32 } from "node:zlib";
import { decodeDifferences, encodeDifferences, inParts, loadCases } from "../js/bun/util/zstd-golden/observe";
import "./hardened";
import { without } from "./harness/capabilities";

const { encode, decode } = await loadCases();

describe.skipIf(!!without("a hardened build"))("zstd gives what was recorded", () => {
  test.each(inParts(encode, ["mixed", "small", "workers"], 40))("compress, part %#", async some => {
    expect(await encodeDifferences(some)).toBe("");
  });

  test.each(inParts(decode, ["stored", "encoded"], 80))("decompress, part %#", async some => {
    expect(await decodeDifferences(some)).toBe("");
  });

  test.each([
    [0, 80453, 1594847892],
    [64, 80467, 1782612813],
    [128, 80473, 1689407469],
    [192, 80477, 3779357940],
  ])("a block of literals from %i to 63 more", (from, length, checksum) => {
    let state = 1;
    const next = () => (state = (Math.imul(state, 1103515245) + 12345) >>> 0) >>> 26;
    const bytes = Uint8Array.from({ length: 128 * 1024 }, () => from + (next() & next()));
    const frame = Bun.zstdCompressSync(bytes, { level: 1 });
    expect([frame.length, crc32(frame)]).toEqual([length, checksum]);
  });
});
