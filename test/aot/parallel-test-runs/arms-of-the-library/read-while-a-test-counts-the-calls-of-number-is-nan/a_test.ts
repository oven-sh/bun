import { test } from "bun:test";

test("read() calls Number.isNaN as often as in plain Bun", () => {
  let asked = 0;
  const real = Number.isNaN;
  Number.isNaN = function (value: unknown) {
    asked++;
    return real(value);
  } as typeof Number.isNaN;
  const { Readable } = require("node:stream") as typeof import("node:stream");
  const seen: string[] = [];
  for (const [kind, options, chunks] of [
    ["nothing", {}, []],
    ["one chunk", {}, ["page"]],
    ["three chunks", {}, ["pa", "ge", "s!"]],
    ["three chunks as text", { encoding: "utf8" }, ["pa", "ge", "s!"]],
    ["objects", { objectMode: true }, ["pa", "ge"]],
    ["one chunk and the end", {}, ["page", null]],
  ] as const) {
    const stream = new Readable({ ...options, read() {} });
    for (const chunk of chunks) stream.push(chunk);
    const counts: number[] = [];
    for (const amount of [[], [0], [1], [], [100], []]) {
      const before = asked;
      stream.read(...(amount as [number?]));
      counts.push(asked - before);
    }
    seen.push(kind + ": " + counts.join(" "));
  }
  Number.isNaN = real;
  console.log("Number.isNaN was called: " + seen.join(" . "));
});
