// Literals with spreads and definitions behind branches.
// Env: JSC_aotCountsPath=/dev/null
import { makeUntyped } from "./untyped.js";

interface Options {
  name?: string;
  limit?: number;
  strict?: boolean;
  mode?: string;
  list?: string[];
  [key: string]: unknown;
}
declare const aotRuntimeCounters: undefined | (() => string);
// What the shell has counted so far: a line "<calls>\toperation:<name>" for each operation of the run time that compiled code has called.
const countsSoFar = (): string => (typeof aotRuntimeCounters === "function" ? aotRuntimeCounters() : "");
// The calls in such a text, whatever they were for, but for the operations named.
function callsIn(counts: string, ...besides: string[]): number {
  let sum = 0;
  for (const line of counts.split("\n")) {
    const [calls, name] = line.split("\toperation:");
    if (name !== undefined && !besides.includes(name)) sum += Number(calls);
  }
  return sum;
}
// A source with names of its own is spread by the run time, a store over a member of another type is its work too, and so is a cell where the allocator has none at hand.
const owed = ["operationAOTCopyDataProperties", "operationAOTPutByIdAndCache", "operationAOTAllocateSlow"];

function make(options: Options) {
  return {
    delay: 50,
    pending: 1000,
    context: undefined,
    ...options,
    strict: options.strict ?? false,
    mode: options.mode ?? "fuzzy",
    list: options.list ?? ["a"],
    limit: options.limit ?? 3,
    last: options.name ? options.name.length : -1,
  };
}
function onOneBranch(options: Options, wide: boolean) {
  const made: Record<string, unknown> = { first: 1, ...options };
  if (wide) {
    made.a = 1;
    made.b = 2;
  }
  return made;
}

const given: Options[] = [{}, { name: "n" }, { name: "n", limit: 9, strict: true, mode: "exact", list: [] }, { extra: 1, more: 2, other: 3, name: "long name" }, { last: "overwritten", delay: 1 }];
for (const options of given) {
  console.log(JSON.stringify(make(options)), Object.keys(make(options)).join());
  console.log(JSON.stringify(makeUntyped(options)), Object.keys(makeUntyped(options)).join());
  console.log(JSON.stringify(onOneBranch(options, true)), JSON.stringify(onOneBranch(options, false)));
}
const before = countsSoFar();
let sum = 0;
for (let i = 0; i < 3000; ++i) sum += make(given[i % given.length]).limit + makeUntyped(given[i % given.length]).limit;
const after = countsSoFar();
const asked = callsIn(after, ...owed) - callsIn(before, ...owed);
console.log(sum, asked <= 30 ? "no literal was copied at its end" : asked + " literals were copied at their end");
