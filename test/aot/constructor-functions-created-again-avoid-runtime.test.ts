import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

// Nothing proves that a module which is required inside a function is evaluated once, so nothing proves that its constructor functions are created once.
const files = {
  "pairs.cjs": `
    "use strict";
    const NullObject = (() => {
      const C = function () {};
      C.prototype = Object.create(null);
      return C;
    })();
    function Pair(key, value) {
      this.key = key;
      this.value = value;
    }
    Pair.prototype.describe = function () {
      return this.key + "=" + this.value;
    };
    function parse(header) {
      const parameters = new NullObject();
      let start = 0;
      let pairs = 0;
      for (let index = 0; index <= header.length; index++) {
        if (index !== header.length && header.charCodeAt(index) !== 59) continue;
        const equals = header.indexOf("=", start);
        const pair = new Pair(header.slice(start, equals), header.slice(equals + 1, index));
        if (parameters[pair.key] === undefined) parameters[pair.key] = pair;
        start = index + 1;
        pairs++;
      }
      return { parameters, pairs };
    }
    module.exports = { parse };
  `,
  "main.cjs": `
    "use strict";
    let loaded;
    function library() {
      return loaded || (loaded = require("./pairs.cjs"));
    }
    const rounds = Number(process.argv[2]);
    let last = "";
    for (let round = 0; round < rounds; round++) {
      const { parameters, pairs } = library().parse("charset=utf-" + (round & 7) + ";q=" + (round & 15));
      last = pairs + " " + parameters.charset.describe().length + " " + parameters.q.describe().length;
    }
    console.log(last);
  `,
};

const stores = ["operationAOTPutById", "operationAOTPutByIdAndCache", "operationAOTPutByIdSloppy"];

test("what a constructor function of a module that is required late stores into this stops asking the run time", async () => {
  using dir = tempDir("aot-constructor-functions-created-again", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const counted = async (rounds: number) => {
    const path = join(String(dir), "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], String(dir), env)).toEqual({
      stdout: "2 13 4\n",
      stderr: "",
      exitCode: 0,
    });
    let sum = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined && stores.includes(name)) sum += Number(count);
    }
    return sum;
  };
  const few = await counted(400);
  const many = await counted(4400);
  expect(many - few).toBeLessThan(200);
}, 240_000);
