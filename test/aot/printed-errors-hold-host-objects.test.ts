// The formatter behind console.log prints an error with its cause and with whatever else lies on it. A stream, a URL or a Buffer there prints itself, and the streams do so by the printer of node:util,
// which an executable holds only where the build has seen a use for it. Each program stands alone: one that needs the printer would hide another that lacks it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

async function outputOf(cmd: string[], cwd: string) {
  const { stdout, stderr } = await run(cmd, cwd, env);
  // Plain Bun shows the line of the source above an error, and the two name the file differently.
  return (stdout + stderr)
    .split("\n")
    .filter(line => !/^ *\d+ \| |^ +\^+ *$|^ +at /.test(line))
    .join("\n");
}

describe.concurrent("prints what plain Bun prints", () => {
  test.each([
    `console.log(new Error("x"));`,
    `console.log(new Error("x", { cause: new ReadableStream() }));`,
    `console.log(new Error("x", { cause: new WritableStream() }));`,
    `console.log(new Error("x", { cause: new Response("a").body }));`,
    `console.log(new Error("x", { cause: new ReadableStream().getReader() }));`,
    `console.log(new Error("x", { cause: Buffer.from("ab") }));`,
    `console.log(new Error("x", { cause: new URL("https://example.com/a") }));`,
    `console.log(new Error("x", { cause: performance.mark("m") }));`,
    `console.log(new Error("x", { cause: { stream: new ReadableStream() } }));`,
    `const error: any = new Error("z"); error[0] = new WritableStream(); console.log(error);`,
    `const error: any = new Error("z"); error.extra = new TransformStream(); console.log(error);`,
    `console.log(new AggregateError([new Error("a"), new TypeError("b", { cause: new ReadableStream() })], "many"));`,
    `class Custom { [Symbol.for("nodejs.util.inspect.custom")]() { return "custom!"; } } console.log(new Error("x", { cause: new Custom() }));`,
    `const date: any = new Date(0); date.stream = new ReadableStream(); console.log(date);`,
    `try { AbortSignal.abort(new ReadableStream()).throwIfAborted(); } catch (error) { console.error(error); }`,
    `try { await Promise.reject(new ReadableStream()); } catch (error) { console.error(error); }`,
    `try { await new Response(new ReadableStream({ start(c) { c.error(new WritableStream()); } })).text(); } catch (error) { console.error(error); }`,
  ])(
    "%s",
    async text => {
      using dir = tempDirWithBunTypes("aot-printed-errors", { "main.ts": text });
      const cwd = String(dir);
      const build = await outputOf([bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "main"], cwd);
      const [plain, compiled] = await Promise.all([
        outputOf([bunExe(), "run", "./main.ts"], cwd),
        outputOf([join(cwd, "main")], cwd),
      ]);
      expect({ compiled, build }).toEqual({ compiled: plain, build });
    },
    120_000,
  );
});
