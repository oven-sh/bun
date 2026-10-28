import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { describe, test } from "./supported";

// What each option changes is printed, so an option that is lost shows. Of a warning the first line is printed: the lines
// below it name positions, which are those of the source with --aot and those of the bundle without.
const program = `import dns from "node:dns";
import http from "node:http";
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
console.log("header size:", http.maxHeaderSize);
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

const optionLists = [
  "",
  "--smol",
  "--expose-gc",
  "--title=own",
  "--console-depth=1",
  "--console-depth=9",
  "--no-deprecation",
  "--throw-deprecation",
  "--unhandled-rejections=strict",
  "--unhandled-rejections=warn",
  "--unhandled-rejections=none",
  "--max-http-header-size=64",
  "--dns-result-order=ipv4first",
  "--dns-result-order=ipv6first",
  "--user-agent=own",
  "--zero-fill-buffers",
  "--disallow-code-generation-from-strings",
  "--smol --expose-gc --title=own --console-depth=1 --no-deprecation --user-agent=own --max-http-header-size=64",
];

async function spawned(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

// A list is three builds, two of them ahead of time, and the lists of a part are built at once.
export function execArgvAsWithoutAot(part: number, parts: number) {
  describe.concurrent("an executable with --compile-exec-argv answers with --aot as it does without", () => {
    test.each(optionLists.filter((_, index) => index % parts === part - 1))(
      "%j",
      async options => {
        using dir = tempDir("compile-exec-argv", { "main.mjs": program });
        const folder = String(dir);
        const kinds: [name: string, flags: string[]][] = [
          ["without --aot", []],
          ["--aot", ["--aot"]],
          ...(canTrim ? ([["--aot --trim", ["--aot", "--trim"]]] as [string, string[]][]) : []),
        ];
        const found: Record<string, unknown> = {};
        for (const [name, flags] of kinds) {
          const outfile = join(folder, name.replaceAll(" ", ""), "main");
          const embedded = options ? ["--compile-exec-argv=" + options] : [];
          const built = await spawned(
            [bunExe(), "build", "--compile", ...flags, ...embedded, "main.mjs", "--outfile", outfile],
            folder,
          );
          expect({ name, stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
            name,
            stderr: "",
            exitCode: 0,
          });
          const { stdout, exitCode } = await spawned([outfile, "--own", "argument"], folder);
          found[name] = { stdout, exitCode };
        }
        expect({ ...(found["without --aot"] as object) }).toMatchObject({
          stdout: expect.stringContaining(`argv: ["--own","argument"]`),
        });
        for (const [name] of kinds)
          expect({ name, ...(found[name] as object) }).toEqual({ name, ...(found["without --aot"] as object) });
      },
      240_000,
    );
  });
}
