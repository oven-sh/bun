// An executable built with --compile-exec-argv answers with --aot, and with --aot --trim, as it does without.
import { describe, expect, test } from "bun:test";
import { bunEnv } from "harness";
import { canTrim } from "../bundler/compile-trim-features";
import { unsupported } from "./harness/compiler";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

// What each option changes is printed, so an option that is lost shows. Of a warning the first line is printed: the lines
// below it name positions, which are those of the source with --aot and those of the bundle without.
const program = `import dns from "node:dns";
const has = option => process.execArgv.some(written => written.startsWith(option));
process.on("warning", warning => console.log("warning:", warning.name, warning.message.split("\\n")[0]));
process.on("exit", code => console.log("exit:", code));
const server = Bun.serve({ port: 0, fetch: request => new Response(request.headers.get("user-agent")) });
console.log("execArgv:", JSON.stringify(process.execArgv));
console.log("argv:", JSON.stringify(process.argv.slice(2)));
console.log("title:", process.title === "own");
console.log("gc:", typeof globalThis.gc);
console.log("nested:", { a: { b: { c: { d: { e: 1 } } } } });
console.log("deprecation:", process.noDeprecation, process.throwDeprecation);
try {
  process.emitWarning("old", "DeprecationWarning", "DEP0");
  console.log("warned");
} catch (error) {
  console.log("thrown:", error.name, error.message);
}
console.log("dns order:", dns.getDefaultResultOrder());
console.log("user agent:", await (await fetch(server.url)).text());
console.log("zero filled:", !has("--zero-fill-buffers") || Buffer.allocUnsafe(65536).every(byte => byte === 0));
try {
  console.log("text:", new Function("return 1 + " + process.argv.length)());
} catch (error) {
  console.log("text:", error.name);
}
server.stop(true);
await new Promise(resolve => setImmediate(resolve));
Promise.reject(new Error("nobody catches this"));
`;
const readsHeaderSize = `import http from "node:http";\nconsole.log("header size:", http.maxHeaderSize);\n`;

// Each value of each option stands in one of the lists.
const optionLists: [entry: string, options: string][] = [
  ["main.mjs", ""],
  [
    "main.mjs",
    "--smol --expose-gc --title=own --console-depth=1 --no-deprecation --unhandled-rejections=none --dns-result-order=ipv4first --user-agent=own --zero-fill-buffers",
  ],
  [
    "main.mjs",
    "--console-depth=9 --throw-deprecation --unhandled-rejections=strict --dns-result-order=ipv6first --disallow-code-generation-from-strings",
  ],
  ["main.mjs", "--unhandled-rejections=warn"],
  ["header-size.mjs", "--max-http-header-size=64"],
];

describe
  .skipIf(!!unsupported)
  .concurrent("an executable with --compile-exec-argv answers with --aot as it does without", () => {
    const { folder, build, buildWholeAndTrimmed } = sharedBuilds("compile-exec-argv", {
      "main.mjs": program,
      "header-size.mjs": readsHeaderSize,
    });

    test.each(optionLists)("%s %j", async (entry, options) => {
      const embedded = options ? ["--compile-exec-argv=" + options] : [];
      const answerOf = async ({ executable }: { executable: string }) => {
        const { stdout, exitCode } = await run([executable, "--own", "argument"], folder, { ...bunEnv, NO_COLOR: "1" });
        return { stdout, exitCode };
      };
      const without = await answerOf(await build(entry, ...embedded));
      if (entry === "main.mjs") expect(without.stdout).toContain(`argv: ["--own","argument"]`);
      else expect(without.stdout).toBe("header size: 64\n");
      if (!canTrim) return void expect(await answerOf(await build(entry, "--aot", ...embedded))).toEqual(without);
      for (const built of await buildWholeAndTrimmed(entry, ...embedded))
        expect(await answerOf(built)).toEqual(without);
    });
  });
