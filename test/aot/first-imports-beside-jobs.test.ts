import { startedAs } from "./fuzz/turns-in-which-imports-settle";
import { eventsBesideLoad, make, makeEventBesideLoad, programs } from "./generated/first-imports-beside-jobs";
import { generated } from "./generated/run-generated";

// The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
const plainEnv = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };
const always = { isAlwaysRun: true, isOnlyCompiled: true as const, keepsItsText: true as const, plainEnv };

generated("first imports beside jobs", [
  ...Object.keys(programs).map(name => ({ name, ...always, make: () => make(name) })),
  ...Object.keys(eventsBesideLoad).map(name => ({
    name: `a job beside the load ${name}`,
    ...always,
    make: () => makeEventBesideLoad(name),
  })),
  ...Object.keys(eventsBesideLoad).map(name => ({
    name: `a job beside two loads ${name}`,
    ...always,
    make: () => makeEventBesideLoad(name, true),
  })),
  // The same programs where their first file is itself loaded by import(). AOT_GENERATED=all takes them.
  ...(["a further entry point", "imported by name"] as const).flatMap(form => [
    ...Object.keys(programs).map(name => ({
      name: `${name}, ${form}`,
      ...always,
      isAlwaysRun: false,
      make: () => startedAs(form, make(name)),
    })),
    ...Object.keys(eventsBesideLoad).map(name => ({
      name: `a job beside the load ${name}, ${form}`,
      ...always,
      isAlwaysRun: false,
      make: () => startedAs(form, makeEventBesideLoad(name)),
    })),
  ]),
]);
