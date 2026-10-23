// A getter or a method of the host answers an object that native code has made before: the body of a response, the headers of a request, an end of a transform stream. Some of these print themselves by the
// printer of node:util, which an executable holds only where the build has seen a use for it. Each program stands alone: one that needs the printer would hide another that lacks it.
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
    `console.log(new Response("a").body);`,
    `console.log(new Request("http://localhost", { method: "POST", body: "x" }).body);`,
    `console.log(new Blob(["a"]).stream());`,
    `console.log(new URL("http://localhost/?b=1").searchParams);`,
    `console.log(new Request("http://localhost").signal);`,
    `console.log(new Request("http://localhost").headers);`,
    `console.log(new Response("a").headers);`,
    `console.log(new TransformStream().readable);`,
    `console.log(new CompressionStream("gzip").readable);`,
    `console.log(new ReadableStream().tee());`,
    `console.log(new WritableStream().getWriter());`,
    `console.log(new ReadableStream().pipeThrough(new TransformStream()));`,
    `console.log(await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign"]));`,
    `console.log(await new Response("a").blob());`,
    `console.log(new Response("a").clone(), new Request("http://localhost").clone());`,
    `console.log(structuredClone(new Uint8Array(2)), structuredClone(Buffer.from("a")));`,
  ])(
    "%s",
    async text => {
      using dir = tempDirWithBunTypes("aot-printed-host-objects", { "main.ts": text });
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
