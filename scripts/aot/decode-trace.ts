#!/usr/bin/env bun
// Decodes the trace string that Bun's crash handler prints (the last part of the bun.report URL), locally.
//
//   bun scripts/aot/decode-trace.ts <file with the crash's output, or -> [--exe <unstripped bun>] [--map <map of the image>]
//
// --exe: frames in Bun itself are resolved with llvm-symbolizer against it. It must have the layout of the executable
//        that crashed: bun-profile for bun, bun-slim-profile for bun-slim.
// --map: frames in ahead-of-time compiled code ("aot" and the offset in the image's code) are resolved with it. See map.ts.
import { spawnSync } from "node:child_process";
import { openSync, readFileSync, readSync } from "node:fs";
import { parseArgs } from "node:util";
import { hex, ImageMap } from "./map.ts";

const { values, positionals } = parseArgs({
  options: { exe: { type: "string" }, map: { type: "string" } },
  allowPositionals: true,
});
if (positionals.length !== 1) {
  console.error("usage: bun scripts/aot/decode-trace.ts <file or -> [--exe <unstripped bun>] [--map <map of the image>]");
  process.exit(1);
}

const text = positionals[0] === "-" ? await Bun.stdin.text() : readFileSync(positionals[0], "utf8");
const trace = text.match(/^\s*(?:https?:\/\/[^\/\s]+)?\/\d[\w.\-]*\/(\S+)\s*$/m)?.[1];
if (!trace) {
  console.error("no trace string");
  process.exit(1);
}

type Frame = { object: string; offset: number } | "unknown";

// src/crash_handler/lib.rs: encode_trace_string
function parse(trace: string): Frame[] {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let at = 2 + 1 + 7; // platform and command, version of the format, revision
  const vlq = () => {
    let value = 0n;
    for (let shift = 0n; ; shift += 5n) {
      const digit = alphabet.indexOf(trace[at++]);
      if (digit < 0) throw new Error("the trace string is cut short");
      value |= BigInt(digit & 31) << shift;
      if (!(digit & 32)) return Number(value & 1n ? -(value >> 1n) : value >> 1n);
    }
  };
  vlq(); // features
  vlq();
  const frames: Frame[] = [];
  while (at < trace.length) {
    if (trace[at] === "_") {
      frames.push("unknown");
      at++;
      continue;
    }
    const value = vlq();
    if (value === 0) break;
    if (value !== 1) {
      frames.push({ object: "", offset: value });
      continue;
    }
    const length = vlq();
    const object = trace.slice(at, at + length);
    at += length;
    frames.push({ object, offset: vlq() });
  }
  return frames;
}

function symbolize(exe: string, offsets: number[]): string[] {
  const magic = Buffer.alloc(4);
  readSync(openSync(exe, "r"), magic, 0, 4, 0);
  const base = magic.readUInt32LE(0) === 0xfeedfacf ? 0x100000000 : 0; // where a Mach-O executable's __TEXT is linked
  const { stdout, error } = spawnSync(
    process.env.LLVM_SYMBOLIZER ?? "llvm-symbolizer",
    [`--obj=${exe}`, "--functions=linkage", "--no-inlines", "-C", ...offsets.map(offset => hex(base + offset))],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  );
  if (error) throw error;
  return stdout
    .split("\n\n")
    .filter(block => block.trim())
    .map(block => block.split("\n")[0]);
}

const frames = parse(trace);
const inBun = frames.flatMap(frame => (frame !== "unknown" && frame.object === "" ? [frame.offset] : []));
const names = values.exe && inBun.length ? symbolize(values.exe, inBun) : [];
const map = values.map ? new ImageMap(values.map) : undefined;

let next = 0;
frames.forEach((frame, number) => {
  let line: string;
  if (frame === "unknown") line = "unknown";
  else if (frame.object === "") line = names[next++] ?? hex(frame.offset);
  else {
    line = `${frame.object}+${hex(frame.offset)}`;
    if (frame.object === "aot" && map) line += "  " + map.describe(frame.offset);
  }
  console.log(`${String(number).padStart(2)}  ${line}`);
});
