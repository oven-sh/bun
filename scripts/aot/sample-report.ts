#!/usr/bin/env bun
// Where an executable that was compiled ahead of time spends its time, from the output of macOS's `sample`.
//
//   sample <pid> <seconds> -file <file>
//   bun scripts/aot/sample-report.ts <file> --map <map of the image> --code-at <address> [--top 30] [--thread <substring of its name>]
//
// The address is where that process has the code, which it prints when it starts with BUN_AOT_VERBOSE=1 ("of code at 0x...").
//
// `sample` cannot name anything in the image. This gives each sample in it to a compiled function, a stub or the code
// of a regular expression. See map.ts for the map.
//
// For a function: `own` is time in its code, `stubs` in stubs it called, `native` in the runtime underneath it.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type CompiledFunction, ImageMap, nameOf, type Place } from "./map.ts";

const { values: args, positionals } = parseArgs({
  options: {
    map: { type: "string" },
    "code-at": { type: "string" },
    top: { type: "string", default: "30" },
    thread: { type: "string" },
  },
  allowPositionals: true,
});
if (positionals.length !== 1 || !args.map || !args["code-at"]) {
  console.error(
    "usage: bun scripts/aot/sample-report.ts <output of sample> --map <map of the image> --code-at <address>",
  );
  process.exit(1);
}
const map = new ImageMap(args.map, args["code-at"]);

function placeOf(frame: string): Place | undefined {
  const address = frame.match(/\[(0x[0-9a-f]+)\]/)?.[1];
  const offset = Number(address) - map.addressOfCode;
  return offset >= 0 && offset < map.sizeOfCode ? map.at(offset) : undefined;
}

// The call graph is a tree in text: the depth is the width of what precedes the count.
const text = readFileSync(positionals[0], "utf8");
const graph = text.slice(text.indexOf("Call graph:"), text.indexOf("Total number in stack"));
type Node = { depth: number; count: number; self: number; frame: string };
const nodes: Node[] = [];
for (const line of graph.split("\n").slice(1)) {
  const [, prefix, count, frame] = line.match(/^([ +!:|]*?)(\d+) (.*)$/) ?? [];
  if (count) nodes.push({ depth: prefix.length, count: +count, self: +count, frame });
}
const stack: Node[] = [];
for (const node of nodes) {
  while (stack.length && stack.at(-1)!.depth >= node.depth) stack.pop();
  if (stack.length) stack.at(-1)!.self -= node.count;
  stack.push(node);
}

const waiting =
  /^(mach_msg2_trap|kevent64|__psynch_cvwait|__semwait_signal|__workq_kernreturn|__ulock_wait|semaphore_wait_trap|semaphore_timedwait_trap|start_wqthread|__psynch_mutexwait)/;

const byStub = new Map<string, number>();
const byFunction = new Map<CompiledFunction, { own: number; stubs: number; native: number }>();
const totals = { function: 0, stub: 0, regexp: 0, nothing: 0, native: 0 };
stack.length = 0;
let inThread = !args.thread;
for (const node of nodes) {
  while (stack.length && stack.at(-1)!.depth >= node.depth) stack.pop();
  stack.push(node);
  if (stack.length === 1 && args.thread) inThread = node.frame.includes(args.thread);
  if (!inThread || node.self <= 0 || waiting.test(node.frame)) continue;

  // The innermost compiled function on the stack.
  let caller: CompiledFunction | undefined;
  for (let at = stack.length - 1; at >= 0 && !caller; at--) {
    const above = placeOf(stack[at].frame);
    if (above?.in === "function") caller = above.function;
  }
  if (caller && !byFunction.has(caller)) byFunction.set(caller, { own: 0, stubs: 0, native: 0 });
  const row = caller && byFunction.get(caller)!;

  const place = placeOf(node.frame);
  if (!place) {
    if (!row) continue;
    row.native += node.self;
    totals.native += node.self;
    continue;
  }
  totals[place.in] += node.self;
  if (place.in === "function") row!.own += node.self;
  else if (place.in === "stub") {
    byStub.set(place.name, (byStub.get(place.name) ?? 0) + node.self);
    if (row) row.stubs += node.self;
  }
}

const inImage = totals.function + totals.stub + totals.regexp + totals.nothing;
const count = (value: number) => String(value).padStart(7);
const percent = (part: number, whole: number) => (whole ? (100 * part) / whole : 0).toFixed(1).padStart(5) + "%";
console.log(`${inImage} samples in the image, ${totals.native} in the runtime underneath compiled functions`);
console.log(`${count(totals.function)} ${percent(totals.function, inImage)}  compiled functions`);
console.log(`${count(totals.stub)} ${percent(totals.stub, inImage)}  stubs`);
console.log(`${count(totals.regexp)} ${percent(totals.regexp, inImage)}  regular expressions`);
if (totals.nothing)
  console.log(`${count(totals.nothing)} ${percent(totals.nothing, inImage)}  nothing that the map knows`);

console.log(`\nstubs, by their own time`);
for (const [name, samples] of [...byStub].sort((a, b) => b[1] - a[1]).slice(0, +args.top))
  console.log(`${count(samples)} ${percent(samples, totals.stub)}  ${name}`);

console.log(`\nfunctions, by their own time and that of the stubs they called\n    own   stubs  native`);
for (const [compiled, { own, stubs, native }] of [...byFunction]
  .sort((a, b) => b[1].own + b[1].stubs - (a[1].own + a[1].stubs))
  .slice(0, +args.top))
  console.log(`${count(own)} ${count(stubs)} ${count(native)}  ${nameOf(compiled)}`);
