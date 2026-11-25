// --aot-check=FlowFixpoint applies every rule of Link's flow analysis once more to the solved sets and reports anything that still grows.
// An update to a call only queues the call, and types that widen where objects merge are folded in later. The check must resolve the queued calls and count what the fold widens.
// The injected fault, --aot-testing=IgnoreEscapeAfterUnknownCall, makes a super() call ignore the update that its new.target became unknown.
// Neither program has a shared call with dormant members, so nothing else reruns the flow. In the second program no class has a field, so types widen only where objects merge.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const program = (fox: string, expression: string) => `class Animal {}
class Ant extends Animal {}
class Bee extends Animal {}
class Cat extends Animal {}
class Dog extends Animal {}
class Fox extends Animal {${fox}}
class Gnu extends Animal {}
const zoo = [new Ant(), new Bee(), new Cat(), new Dog(), new Fox(), new Gnu()];
function echo(n) { return n; }
zoo[8 % zoo.length]["sp" + (zoo.length > 3 ? "eak" : "xx")] = echo;
console.log(zoo.length, ${expression});
`;

describe.skipIf(!!unsupported)("the flow fixpoint check", () => {
  for (const [name, text, printed] of [
    [
      "resolves the calls that it queues",
      program(" constructor() { super(); this.legs = 4; } ", "zoo[4].legs"),
      "6 4\n",
    ],
    ["counts types widened at object merges", program("", "zoo[2].speak(3)"), "6 3\n"],
  ])
    test(name, () =>
      slot(async () => {
        using dir = tempDir("aot-flow-fixpoint", { "main.js": text });
        const folder = String(dir);
        const build = (outfile: string, ...flags: string[]) =>
          spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              "--aot-check=FlowFixpoint",
              ...withoutDebugInformation,
              ...flags,
              "./main.js",
              "--outfile",
              outfile,
            ],
            folder,
            env,
          );
        const closed = await build("right");
        expect({ stderr: closed.stderr.includes("FlowEndedTooEarly"), exitCode: closed.exitCode }).toEqual({
          stderr: false,
          exitCode: 0,
        });
        const right = await spawned([join(folder, isWindows ? "right.exe" : "right")], folder, env);
        expect({ stdout: right.stdout, exitCode: right.exitCode }).toEqual({ stdout: printed, exitCode: 0 });
        const faulty = await build("faulty", "--aot-testing=IgnoreEscapeAfterUnknownCall");
        expect(faulty.stderr).toContain("FlowEndedTooEarly");
        expect(faulty.exitCode).toBe(1);
      }),
    );
});
