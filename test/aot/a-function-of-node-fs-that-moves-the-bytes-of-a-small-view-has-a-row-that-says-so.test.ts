// A function of node:fs that is handed a small view as a path pins the view while it reads it, and that moves the bytes out of the cell: what compiled code knows of where the bytes lie is void behind the call.
// A program sees the move by what the cell weighs. Each function that moves the bytes has a row in the table of built-ins that says that it writes the storage of views.
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { expect } from "bun:test";
import { bunExe } from "harness";
import fs from "node:fs";
import { builtinTableOf } from "./harness/builtin-table";
import { test } from "./supported";

const names = [
  "accessSync",
  "existsSync",
  "lstatSync",
  "readFileSync",
  "readdirSync",
  "readlinkSync",
  "realpathSync",
  "statSync",
] as const;

test("a function of node:fs that moves the bytes of a small view has a row that says so", () => {
  const table = JSON.parse(fs.readFileSync(builtinTableOf(bunExe()), "utf8")) as {
    entries: { token: string; overloads: { writes: string[] }[] }[];
  };
  const rows = new Map(table.entries.map(entry => [entry.token, entry.overloads]));
  const moved = names.filter(name => {
    const here = Uint8Array.of(".".charCodeAt(0));
    const weight = estimateShallowMemoryUsageOf(here);
    try {
      fs[name](here);
    } catch {}
    return estimateShallowMemoryUsageOf(here) !== weight;
  });
  expect(moved.length).toBeGreaterThan(0);
  const silent = moved.filter(name => {
    const overloads = rows.get("NodeJSFSPrototype" + name[0].toUpperCase() + name.slice(1))!;
    return !overloads.every(row => row.writes.includes("TypedArrayStorage"));
  });
  expect(silent).toEqual([]);
});
