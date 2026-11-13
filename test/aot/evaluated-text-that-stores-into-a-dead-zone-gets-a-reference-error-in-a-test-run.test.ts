import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// `try { eval("late = 2"); } catch (error) { .. } const late = 1;`: a compiled test file used to get the TypeError of a store into a constant.
// The binding is not yet initialized, so it is a ReferenceError, whatever kind the binding has. Executables: parallel/stores-by-evaluated-text-into-dead-zones.
const project = casesOfOneRun("evaluated-text-that-stores-into-a-dead-zone-gets-a-reference-error-in-a-test-run", {
  "package.json": `{ "name": "p", "type": "module" }`,
});

function runsAsPlain(title: string, expected: string, probe: string) {
  const name = project.add(
    name => `
      import { test } from "bun:test";
      ${sayOf(name)}
      function attempt(run) { try { return "answered " + String(run()); } catch (error) { return error.constructor.name; } }
      function probe() { ${probe} }
      test("${name}", () => say(probe()));`,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain?.printed).toBe(expected + "\n");
    expect((await project.ran(["--debug-aot"])).get(name)).toEqual(plain);
  });
}

const early = `const early = attempt(() => eval(text));`;
const late = `return early + " | " + attempt(() => eval(text)) + " | " + late;`;

runsAsPlain(
  "a store into a constant",
  "ReferenceError | TypeError | 1",
  `const text = "late = 2"; ${early} const late = 1; ${late}`,
);

runsAsPlain(
  "a pattern that names a constant",
  "ReferenceError | TypeError | 1",
  `const text = "[late] = [2]"; ${early} const late = 1; ${late}`,
);

runsAsPlain(
  "a function that the text makes, called early and late",
  "ReferenceError | TypeError | 1",
  `const store = eval("() => { late = 2; }"); const early = attempt(store); const late = 1; return early + " | " + attempt(store) + " | " + late;`,
);

runsAsPlain(
  "the name that a class has inside itself, while its parent is computed",
  "ReferenceError | function",
  `let seen; class Late extends (seen = attempt(() => eval("Late = 2")), Object) {} return seen + " | " + typeof Late;`,
);

runsAsPlain(
  "a variable is refused in its dead zone and stored behind it",
  "ReferenceError | answered 2 | 2",
  `const text = "late = 2"; ${early} let late = 1; ${late}`,
);
