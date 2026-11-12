// A function of node:fs, or Bun.file, that is handed a small view as a path copies the bytes and does not pin the view. So the bytes stay in the cell: what compiled code knows of where they lie still holds behind the call.
// A program would see a move by what the cell weighs.
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { expect } from "bun:test";
import fs from "node:fs";
import { test } from "./supported";

const named = [
  "accessSync",
  "existsSync",
  "lstatSync",
  "readFileSync",
  "readdirSync",
  "readlinkSync",
  "realpathSync",
  "statSync",
] as const;

const calls: [name: string, call: (path: Uint8Array) => unknown][] = [
  ...named.map(name => [name, (path: Uint8Array) => fs[name](path)] as [string, (path: Uint8Array) => unknown]),
  ["Bun.file", path => Bun.file(path)],
];

test("a small view that is a path keeps its bytes where they are", () => {
  const moved = calls.filter(([, call]) => {
    const here = Uint8Array.of(".".charCodeAt(0));
    const weight = estimateShallowMemoryUsageOf(here);
    try {
      call(here);
    } catch {}
    return estimateShallowMemoryUsageOf(here) !== weight;
  });
  expect(moved.map(([name]) => name)).toEqual([]);
});
