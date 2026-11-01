import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const asked = `import { test, expect } from "bun:test";

const calls = [];
const shape = a => ({ a });
class Box { constructor(a) { this.a = a; } }
class Matcher { constructor(a) { this.a = a; } asymmetricMatch(other) { calls.push("class"); return true; } }
const name = "asymmetric" + String("Match");
const both = other => (calls.push("both"), false);

const matchers = {
  "in the literal": () => ({ a: 1, asymmetricMatch(other) { calls.push("literal"); return true; } }),
  "added later": () => { const o = shape(1); o.asymmetricMatch = other => (calls.push("later"), true); return o; },
  "added by a computed name": () => { const o = shape(1); o[name] = other => (calls.push("computed"), true); return o; },
  "added to an instance": () => { const o = new Box(1); o.asymmetricMatch = other => (calls.push("instance"), true); return o; },
  "assigned": () => Object.assign(shape(1), { asymmetricMatch: other => (calls.push("assigned"), true) }),
  "defined": () => Object.defineProperty(shape(1), "asymmetricMatch", { value: other => (calls.push("defined"), true) }),
  "on the class": () => new Matcher(1),
  "says no": () => { const o = shape(2); o[name] = other => (calls.push("no"), false); return o; },
  "set to undefined": () => { const o = shape(2); o.asymmetricMatch = undefined; return o; },
  "no function": () => { const o = shape(2); o.asymmetricMatch = 1; return o; },
  "deleted again": () => { const o = shape(2); o.asymmetricMatch = both; delete o.asymmetricMatch; return o; },
};
const others = {
  "same shape": () => shape(2),
  "same class": () => new Box(2),
  "other shape": () => ({ z: 1 }),
  "number": () => 7,
  "a matcher too": () => { const o = shape(2); o.asymmetricMatch = both; return o; },
};
const ways = {
  "toEqual": (other, matcher) => expect(other).toEqual(matcher),
  "turned round": (other, matcher) => expect(matcher).toEqual(other),
  "not.toEqual": (other, matcher) => expect(other).not.toEqual(matcher),
  "inside": (other, matcher) => expect({ w: other }).toEqual({ w: matcher }),
  "in an array": (other, matcher) => expect([other]).toEqual([matcher]),
  "toStrictEqual": (other, matcher) => expect({ w: other }).toStrictEqual({ w: matcher }),
  "toMatchObject": (other, matcher) => expect({ w: other }).toMatchObject({ w: matcher }),
  "toMatchObject turned round": (other, matcher) => expect({ w: matcher }).toMatchObject({ w: other }),
  "toContainEqual": (other, matcher) => expect([other]).toContainEqual(matcher),
  "toHaveProperty": (other, matcher) => expect({ w: other }).toHaveProperty("w", matcher),
};

test("asked", () => {
  for (const [m, matcher] of Object.entries(matchers)) {
    for (const [o, other] of Object.entries(others)) {
      for (const [w, run] of Object.entries(ways)) {
        calls.length = 0;
        let passed = true;
        try { run(other(), matcher()); } catch { passed = false; }
        console.log("SAY " + m + " | " + o + " | " + w + " | " + (passed ? "pass" : "fail") + " | " + calls.join(" "));
      }
    }
  }
});
`;

test("an object's own asymmetricMatch() is called where bun test calls it", async () => {
  using dir = tempDir("aot-matcher-method", { "asked.test.js": asked });
  const tell = async (...flags: string[]) => {
    const ran = await run([bunExe(), "test", ...flags, "./asked.test.js"], String(dir), { ...bunEnv, NO_COLOR: "1" });
    const said = (ran.stdout + ran.stderr).split("\n").filter(line => line.startsWith("SAY "));
    return { said, exitCode: ran.exitCode };
  };
  const compiled = await tell("--aot");
  expect(compiled.said).toContain("SAY added later | same shape | toEqual | pass | later");
  expect(compiled.said).toContain("SAY added later | same shape | not.toEqual | fail | later");
  expect(compiled.said).toContain("SAY says no | same shape | toMatchObject turned round | fail | no");
  expect(compiled.said).toContain("SAY added to an instance | same class | inside | pass | instance");
  expect(compiled.said.length).toBe(11 * 5 * 10);
  expect(compiled).toEqual(await tell());
}, 240_000);
