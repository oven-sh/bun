// Functions that do little themselves, so most of a call is what src/codegen/bindgen.ts generates around them:
// converting the arguments and the result.
import { getHashes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { bench, group, run } from "../runner.mjs";

const bytes = new Uint8Array(16);
const decoder = new TextDecoder();
// No string below starts with a "b", so matching stops at the first character.
const glob = new Bun.Glob("b");

group("an options object", () => {
  const stream = { stream: true };
  const inspect = { depth: 2, colors: false };
  const markdown = { tables: true, strikethrough: true, tasklists: false };
  const inherited = Object.create(stream);

  bench("1 of 1 members", () => decoder.decode(bytes, stream));
  bench("1 of 1 members, inherited", () => decoder.decode(bytes, inherited));
  bench("2 of 4 members", () => Bun.inspect(1, inspect));
  bench("0 of 24 members", () => Bun.markdown.html("a", {}));
  bench("3 of 24 members", () => Bun.markdown.html("a", markdown));
});

group("a string as UTF-8", () => {
  for (const length of [6, 15, 31, 63, 255]) {
    const ascii = Buffer.alloc(length, "a").toString();
    bench(`${length} ASCII characters`, () => glob.match(ascii));
  }
  bench("15 Latin-1 characters", () => glob.match("aaaaaaaaaaaaaaé"));
  bench("15 UTF-16 characters", () => glob.match("aaaaaaaaaaaaaaπ"));
});

group("other arguments", () => {
  bench("any number of strings", () => path.join("a", "b", "c"));
  bench("an enumeration", () => Bun.color("red", "number"));
});

group("an array as the result", () => {
  bench("3 numbers", () => os.loadavg());
  bench(`${Bun.CryptoHasher.algorithms.length} strings`, () => Bun.CryptoHasher.algorithms);
  bench(`${getHashes().length} strings`, () => getHashes());
});

// With --expose-internals: results that no public function makes this cheaply.
const internals = await import("bun:internal-for-testing").catch(() => null);
if (internals) {
  const { linearFifoOrderedRemoveProbe: numbers, proxyInternals } = internals;
  group("more results", () => {
    bench("an array of 0 numbers", () => numbers(2));
    bench("an array of 7 numbers", () => numbers(1));
    bench("an array of 13 numbers", () => numbers(0));
    bench("a record of 5 strings", () => proxyInternals.parseURL("http://user:pass@example.com:8080/path"));
  });
}

await run();
