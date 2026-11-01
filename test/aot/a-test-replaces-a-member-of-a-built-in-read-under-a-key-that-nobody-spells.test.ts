import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// The cases share the layers below them, so each writes on an object of its own and none puts a member back by a store.
const project = casesOfOneRun("a-test-replaces-a-member-of-a-built-in-read-under-a-key-that-nobody-spells", {
  "package.json": `{ "name": "p", "type": "module" }`,
});

function runsAsPlain(title: string, expected: string, body: string) {
  const name = project.add(
    name => `
      import { spyOn, test } from "bun:test";
      ${sayOf(name)}
      const replaced = () => "replaced";
      const joined = (...parts) => parts.join("");
      test("${name}", () => {
        try {
          ${body}
        } catch (error) {
          say("threw", error.name);
        }
      });`,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain?.printed).toBe(expected + "\n");
    expect((await project.ran(["--debug-aot"], "TestRunLayers:2")).get(name)).toEqual(plain);
    expect((await project.ran(["--debug-aot"], "TestRunLayers:0")).get(name)).toEqual(plain);
  });
}

runsAsPlain(
  "a store on what globalThis holds under the key",
  "replaced",
  `globalThis[joined("JS", "ON")].stringify = replaced; say(JSON.stringify([1]));`,
);

runsAsPlain(
  "the global object under another name, and the object kept in a variable",
  "replaced",
  `const held = global[joined("Ma", "th")]; held.cbrt = replaced; say(Math.cbrt(8));`,
);

runsAsPlain("a spy", "5", `spyOn(globalThis[joined("Da", "te")], "now").mockReturnValue(5); say(Date.now());`);

runsAsPlain(
  "the prototype of a class",
  "replaced",
  `Array[joined("proto", "type")].flat = replaced; say([[1]].flat());`,
);

runsAsPlain(
  "two keys, one behind the other",
  "replaced",
  `globalThis[joined("Str", "ing")][joined("proto", "type")].padEnd = replaced; say("a".padEnd(3));`,
);
