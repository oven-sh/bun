import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

const files = {
  "tsconfig.json": `{"compilerOptions":{"target":"esnext","module":"preserve","moduleResolution":"bundler","allowJs":true,"noEmit":true,"strict":true,"types":[]}}`,
  "pair.js": `const programs = {
  0: () => import("./p0.js"),
  1: () => import("./p2.ts"),
};
await programs[process.argv[2]]();
`,
  "p2.ts": `function scene0(given: number[]) {
  [7].forEach((each, at) => made.push((() => {
    })()));
}
class Holder3 {
  run(given: number[]) {
  }
}
console.log(3, JSON.stringify(new Holder3().run([5, 6, 7])));
`,
  "p0.js": `class Log extends Array {
  push(line) {
  }
}
function hashOf(lines) {
  try {
  } catch (error) {
  }
}
async function scene0() {
class Steps {
  [Symbol.iterator]() {
    return {
    };
  }
}
  const step = async turn => {
    try {
    } catch (error) {
    }
    if (turn === 34) {
      try {
      } catch (error) {
      }
    }
  }
}
async function scene1() {
  for (let turn = 0; turn < 400; turn++) {
    if (turn === 314) {
      try {
      } catch (error) {
      }
    }
    try {
    } catch (error) {
    }
    if (turn === 1) {
      try {
      } catch (error) {
      }
    }
  }
}
async function scene3() {
  for (let turn = 0; turn < 3; turn++) {
    if (turn === 1) {
      try {
        Bun.gc(true);
      } catch (error) {
        log.push("the change threw " + error.name);
      }
    }
    try {
      const result = box.run.call(AbortSignal, [controller.signal]);
    } catch (error) {
    }
  }
}
await scene3();
`,
};

const written = "const result = box.run.call(AbortSignal, [controller.signal]);";
const calls = {
  "a list of anything": written,
  "a list of texts": `const result = box.run.call(AbortSignal, ["a", "b"]);`,
  "a list held in a variable": "const list = [controller.signal]; const result = box.run.call(AbortSignal, list);",
  "a bound function": "const result = box.run.bind(AbortSignal)([controller.signal]);",
};

test.each(Object.entries(calls))("a predicted callee takes what the call hands over: %s", async (_, call) => {
  expect(files["p0.js"]).toContain(written);
  using dir = tempDir("aot-predicted-callee-arguments", { ...files, "p0.js": files["p0.js"].replace(written, call) });
  const root = String(dir);
  const outfile = join(root, isWindows ? "pair.exe" : "pair");
  const build = await spawned(
    [bunExe(), ...compileCommand, "--aot-check=verify-each-pass", join(root, "pair.js"), "--outfile", outfile],
    root,
    bunEnv,
  );
  expect(build.stderr + build.stdout).not.toContain("StoredTypeMismatch");
  expect(build.exitCode).toBe(0);
  for (const half of ["0", "1"]) {
    const plain = await spawned([bunExe(), join(root, "pair.js"), half], root, bunEnv);
    const compiled = await spawned([outfile, half], root, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      exitCode: plain.exitCode,
    });
  }
});
