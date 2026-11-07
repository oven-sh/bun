// net.isIPv4() and net.isIPv6() keep one RegExp each. A pattern written as a literal inside the function is a new object at every call: an allocation for every connection that a server accepts.
// `bun run` evaluates src/js/internal/net/isIP.ts, the compiler reads src/js/ahead-of-time/internal/net/isIP.ts: both are held to it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

test("isip tests with one object for each pattern", async () => {
  using dir = tempDir("aot-plain-library", {
    "package.json": `{ "name": "p" }`,
    "a.test.mjs": `import { test } from "bun:test";
import net from "node:net";
test("t", () => {
  const seen = new Set(), real = RegExp.prototype.test;
  RegExp.prototype.test = function (text) { seen.add(this); return real.call(this, text); };
  const answers = [net.isIPv4("1.2.3.4"), net.isIPv4("1.2.3.4"), net.isIPv4("01.2.3.4"), net.isIPv6("::ffff:1.2.3.4"), net.isIPv6("fe80::1%eth0"), net.isIPv6("1:2")];
  RegExp.prototype.test = real;
  console.error("SEEN " + answers.join() + " " + seen.size);
});
`,
  });
  const seenWith = async (...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN "));
    return { seen: lines, exitCode };
  };
  expect(await seenWith()).toEqual({ seen: ["SEEN true,true,false,true,true,false 2"], exitCode: 0 });
  expect(await seenWith("--aot")).toEqual({ seen: ["SEEN true,true,false,true,true,false 2"], exitCode: 0 });
});
