// A typed build of a loop that fails is undone, and the compiler goes on: the program is right and slower. What it says then goes to stderr beside an exit code of 0, where nobody looked:
// the token of a class was asked by a test that takes values alone, sixteen times in one large application, and no test was red.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const programs: Record<string, string> = {
  "01-a-field-through-a-method.mjs":
    "class A { #k = 2; of(x) { return x * this.#k; } }\nconst a = new A();\nfunction f(l) { let s = 0; for (let i = 0; i < l.length; i++) { s += a.of(l[i]); } return s; }\nconst go = [f][JSON.parse('0')];\nconst list = JSON.parse('[1,2,3,4.5]');\nconsole.log(go(list));\n",
  "02-a-brand.mjs":
    "class A { #k = 2; static is(o) { return #k in o; } }\nconst a = new A();\nfunction f(l) { let s = 0; for (let i = 0; i < l.length; i++) { if (A.is(a)) s += l[i] * 2; } return s; }\nconst go = [f][JSON.parse('0')];\nconst list = JSON.parse('[1,2,3,4.5]');\nconsole.log(go(list), A.is({}));\n",
  "03-a-store.mjs":
    "class A { #n = 0; add(x) { this.#n += x; return this.#n; } }\nconst a = new A();\nfunction f(l) { let s = 0; for (let i = 0; i < l.length; i++) { s = a.add(l[i]); } return s; }\nconst go = [f][JSON.parse('0')];\nconst list = JSON.parse('[1,2,3,4.5]');\nconsole.log(go(list), go(list));\n",
  "04-a-private-method.mjs":
    "class A { #k = 2; #m(x) { return x * this.#k; } of(x) { return this.#m(x); } }\nconst a = new A();\nfunction f(l) { let s = 0; for (let i = 0; i < l.length; i++) { s += a.of(l[i]); } return s; }\nconst go = [f][JSON.parse('0')];\nconst list = JSON.parse('[1,2,3,4.5]');\nconsole.log(go(list));\n",
  "12-an-heir.mjs":
    "class A { #k = 2; of(x) { return x * this.#k; } }\nclass B extends A { #k = 5; both(x) { return this.of(x) + this.#k; } }\nconst b = new B();\nfunction f(l) { let s = 0; for (let i = 0; i < l.length; i++) { s += b.both(l[i]); } return s; }\nconst go = [f][JSON.parse('0')];\nconst list = JSON.parse('[1,2,3,4.5]');\nconsole.log(go(list));\n",
};

describe("compile/aot/a-build-that-succeeds-says-nothing-of-its-own-faults", () => {
  for (const [name, program] of Object.entries(programs)) {
    test.skipIf(isDebug || isASAN)(name, async () => {
      using dir = tempDir("aot-a-build-says-nothing", { [name]: program });
      const cwd = String(dir);
      const build = await spawned(
        [bunExe(), "build", "--compile", "--aot", name, "--outfile", join(cwd, "main")],
        cwd,
        bunEnv,
      );
      built(build);
      expect(build.stderr).not.toContain("AOT: ");
      expect(build.stdout).not.toContain("AOT: ");
      const [compiled, plain] = await Promise.all([
        spawned([join(cwd, "main")], cwd, bunEnv),
        spawned([bunExe(), name], cwd, bunEnv),
      ]);
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    });
  }
});
