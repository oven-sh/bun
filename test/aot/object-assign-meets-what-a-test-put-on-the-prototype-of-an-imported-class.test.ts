// A run of many test files is compiled as several programs, and the class here is in a lower one than the test file. Object.assign remembers how it last
// filled an object of the class. What it remembers holds until an object above the target changes, and that was once noted with the wrong program, so
// the first Object.assign of a file decided for all later ones: a setter that a test put on the prototype was never called, and a store that has to
// throw went through.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "src/parts.ts": `
    export class OnlyRead { width: number = 3; size(i: number): string { return "method" + i + this.width; } }
    export class Written { width: number = 3; size(i: number): string { return "method" + i + this.width; } }
    export class Fixed { width: number = 3; size(i: number): string { return "method" + i + this.width; } }
    export class Bare { width: number = 3; }`,
  "a.test.ts": `
    import { test } from "bun:test";
    import { OnlyRead, Written, Fixed, Bare } from "./src/parts";
    function say(label: string, act: () => unknown): void {
      try {
        console.log("SEEN", label, String(act()));
      } catch (error) {
        console.log("SEEN", label, "threw " + (error as Error).constructor.name);
      }
    }
    const own = (i: number) => "own" + i;
    let calls = 0;
    test("a", () => {
      say("a getter alone, before:", () => Object.keys(Object.assign(new OnlyRead(), { size: own })).join());
      Object.defineProperty(OnlyRead.prototype, "size", { get: () => own, configurable: true });
      say("a getter alone:", () => Object.keys(Object.assign(new OnlyRead(), { size: own })).join());

      say("a getter and a setter, before:", () => Object.keys(Object.assign(new Written(), { size: own })).join());
      Object.defineProperty(Written.prototype, "size", { get: () => own, set: () => { calls++; }, configurable: true });
      say("a getter and a setter:", () => Object.keys(Object.assign(new Written(), { size: own })).join() + ", calls of the setter: " + calls);

      say("a value that is not writable, before:", () => Object.keys(Object.assign(new Fixed(), { size: own })).join());
      Object.defineProperty(Fixed.prototype, "size", { value: own, writable: false, configurable: true });
      say("a value that is not writable:", () => Object.keys(Object.assign(new Fixed(), { size: own })).join());

      say("a name that the class never had, before:", () => Object.keys(Object.assign(new Bare(), { extra: 1 })).join());
      Object.defineProperty(Bare.prototype, "extra", { get: () => 5, configurable: true });
      say("a name that the class never had:", () => Object.keys(Object.assign(new Bare(), { extra: 1 })).join());

      delete (Bare.prototype as any).extra;
      say("and with the getter gone again:", () => Object.keys(Object.assign(new Bare(), { extra: 1 })).join());
    });`,
};

test.each(["TestRunLayers:2", "TestRunLayers:1", "TestRunLayers:0"])(
  "Object.assign into an object of an imported class, before and after a test changes the prototype: %s",
  async layers => {
    using dir = tempDir("object-assign-meets-what-a-test-put-on-the-prototype", files);
    const seen = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: layers };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "--isolate"], String(dir), env);
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return stdout.split("\n").filter(line => line.startsWith("SEEN"));
    };
    expect(await seen("--aot")).toEqual(await seen());
    expect(await seen()).toEqual([
      "SEEN a getter alone, before: width,size",
      "SEEN a getter alone: threw TypeError",
      "SEEN a getter and a setter, before: width,size",
      "SEEN a getter and a setter: width, calls of the setter: 1",
      "SEEN a value that is not writable, before: width,size",
      "SEEN a value that is not writable: threw TypeError",
      "SEEN a name that the class never had, before: width,extra",
      "SEEN a name that the class never had: threw TypeError",
      "SEEN and with the getter gone again: width,extra",
    ]);
  },
);
