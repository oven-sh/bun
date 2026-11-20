// A class in one of Bun's own modules that is written over a constructor function (`class EventEmitterAsyncResource extends EventEmitter` in
// node:events, `class DuplexSide extends Duplex` in another file than Duplex) names the layout of that function as its base in the program that
// the front end writes, as a class of a program does. Without the base the engine cannot hold what arrives as the heritage against the record
// where the class is made, and takes the function, its prototype object and all that lies on them to be in the hands of code that it does not see.
//
// Here a Bun that has the engine writes its program with --aot-out, and `testaot print` prints it. What the engine makes of a base is held by
// its own tests, link/a-class-whose-record-names-a-constructor-function-as-its-base-leaves-the-function-in-sight.ir and the control beside it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { built, spawned } from "./harness/commands";
import { buildFlags, compileCommand, withProgramOutput } from "./harness/flags";
import { test } from "./supported";

const program = `
const { EventEmitterAsyncResource } = require("node:events");
const { duplexPair } = require("node:stream");
function Above() { this.first = 1; }
class Below extends Above {}
console.log(typeof EventEmitterAsyncResource, typeof duplexPair, new Below().first);
`;

const declared = without("testaot") ? test.skip : test;

declared(
  "the layout of the function is the base of the class, in one file and across two, as in a program",
  async () => {
    using folder = tempDir("aot-a-class-over-a-constructor-function", { "main.cjs": program });
    const file = join(String(folder), "program.aot");
    const flags = [withProgramOutput(file), buildFlags.withoutExecutable];
    built(await spawned([bunExe(), ...compileCommand, ...flags, "main.cjs"], String(folder), bunEnv));
    const { lines, stderr, exitCode } = await run("print", file);
    expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });

    const layouts = lines.filter(line => line.startsWith("layout ") && line.includes(" kind=Instance "));
    const named = (name: string) => layouts.filter(line => line.includes(` name="${name}" `));
    const functionAbove = (name: string) =>
      named(name)
        .filter(line => /flags=\[[^\]]*IsConstructorFunction/.test(line))
        .map(line => line.split(" ")[1]);
    const baseOf = (name: string) => named(name).map(line => / base=(L\d+)/.exec(line)?.[1] ?? "no base");
    expect({
      EventEmitterAsyncResource: baseOf("EventEmitterAsyncResource"),
      DuplexSide: baseOf("DuplexSide"),
      Below: baseOf("Below"),
    }).toEqual({
      EventEmitterAsyncResource: functionAbove("EventEmitter"),
      DuplexSide: functionAbove("Duplex"),
      Below: functionAbove("Above"),
    });
    expect(functionAbove("EventEmitter").length).toBe(1);
    expect(functionAbove("Duplex").length).toBe(1);
    expect(functionAbove("Above").length).toBe(1);
  },
);
