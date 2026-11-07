// A list of programs from ../generators/first-imports-beside-jobs.ts, which describes them.
import { startedAs } from "../dynamic-import-settle-order";
import { eventsBesideLoad, make, makeEventBesideLoad, programs } from "../generators/first-imports-beside-jobs";
import { family } from "../family";

// Plain Bun transpiles on one thread here, so files are read in request order. An executable reads no files.
const plainEnv = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };
const always = { plainEnv };

// In the ticks in which the loader has fetched the required module but not yet evaluated it, require() evaluates and
// returns it, where plain Bun throws. The lines of those ticks. Every other tick is compared with plain Bun.
const requiredWhileLoaded: Record<string, { oneLoad: Record<string, string>; twoLoads: Record<string, string> }> = {
  "requires the lowest module": {
    oneLoad: {
      "10: ":
        "0 1 2 3 4 5 6 7 8 9 10 low required1 11 12 13 14 mid root 15 16 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "11: ":
        "0 1 2 3 4 5 6 7 8 9 10 11 low required1 12 13 14 mid root 15 16 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
    },
    twoLoads: {
      "10: ":
        "0 1 2 3 4 5 6 7 8 9 second-low second 10 low required1 11 12 13 14 mid root 15 16 SECOND 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "11: ":
        "0 1 2 3 4 5 6 7 8 9 second-low second 10 11 low required1 12 13 14 mid root 15 16 SECOND 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
    },
  },
  "requires the module in the middle": {
    oneLoad: {
      "6: ":
        "0 1 2 3 4 5 6 low mid required2 7 8 9 root 10 11 12 13 14 15 16 IMPORTED 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "10: ":
        "0 1 2 3 4 5 6 7 8 9 10 low mid required2 11 12 13 14 root 15 16 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "11: ":
        "0 1 2 3 4 5 6 7 8 9 10 11 low mid required2 12 13 14 root 15 16 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "12: ":
        "0 1 2 3 4 5 6 7 8 9 10 11 12 low mid required2 13 14 root 15 16 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
    },
    twoLoads: {
      "6: ":
        "0 1 2 3 4 5 6 low mid required2 7 8 9 second-low second root 10 11 12 13 14 15 16 SECOND IMPORTED 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "10: ":
        "0 1 2 3 4 5 6 7 8 9 second-low second 10 low mid required2 11 12 13 14 root 15 16 SECOND 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "11: ":
        "0 1 2 3 4 5 6 7 8 9 second-low second 10 11 low mid required2 12 13 14 root 15 16 SECOND 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "12: ":
        "0 1 2 3 4 5 6 7 8 9 second-low second 10 11 12 low mid required2 13 14 root 15 16 SECOND 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
    },
  },
  "requires the root": {
    oneLoad: {
      "2: ":
        "0 1 2 low mid root required3 3 4 5 6 7 8 9 10 11 IMPORTED 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "6: ":
        "0 1 2 3 4 5 6 low mid root required3 7 8 9 10 11 12 13 14 15 16 IMPORTED 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "10: ":
        "0 1 2 3 4 5 6 7 8 9 10 low mid root required3 11 12 13 14 15 16 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "11: ":
        "0 1 2 3 4 5 6 7 8 9 10 11 low mid root required3 12 13 14 15 16 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "12: ":
        "0 1 2 3 4 5 6 7 8 9 10 11 12 low mid root required3 13 14 15 16 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "13: ":
        "0 1 2 3 4 5 6 7 8 9 10 11 12 13 low mid root required3 14 15 16 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
    },
    twoLoads: {
      "2: ":
        "0 1 2 low mid root required3 3 4 5 6 7 8 9 second-low second 10 11 IMPORTED 12 13 14 15 16 SECOND 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "6: ":
        "0 1 2 3 4 5 6 low mid root required3 7 8 9 second-low second 10 11 12 13 14 15 16 SECOND IMPORTED 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "10: ":
        "0 1 2 3 4 5 6 7 8 9 second-low second 10 low mid root required3 11 12 13 14 15 16 SECOND 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "11: ":
        "0 1 2 3 4 5 6 7 8 9 second-low second 10 11 low mid root required3 12 13 14 15 16 SECOND 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "12: ":
        "0 1 2 3 4 5 6 7 8 9 second-low second 10 11 12 low mid root required3 13 14 15 16 SECOND 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
      "13: ":
        "0 1 2 3 4 5 6 7 8 9 second-low second 10 11 12 13 low mid root required3 14 15 16 SECOND 17 18 19 20 21 IMPORTED 22 23 24 25 26 27 28 29 30 31 32 33 34 35",
    },
  },
};

export default family("first imports beside jobs", [
  ...Object.keys(programs).map(name => ({ name, ...always, make: () => make(name) })),
  ...Object.keys(eventsBesideLoad).map(name => ({
    name: `a job beside the load ${name}`,
    ...always,
    specified: requiredWhileLoaded[name]?.oneLoad,
    make: () => makeEventBesideLoad(name),
  })),
  ...Object.keys(eventsBesideLoad).map(name => ({
    name: `a job beside two loads ${name}`,
    ...always,
    specified: requiredWhileLoaded[name]?.twoLoads,
    make: () => makeEventBesideLoad(name, true),
  })),
  ...(["a further entry point", "imported by name"] as const).flatMap(form => [
    ...Object.keys(programs).map(name => ({
      name: `${name}, ${form}`,
      ...always,
      make: () => startedAs(form, make(name)),
    })),
    ...Object.keys(eventsBesideLoad).map(name => ({
      name: `a job beside the load ${name}, ${form}`,
      ...always,
      specified: requiredWhileLoaded[name]?.oneLoad,
      make: () => startedAs(form, makeEventBesideLoad(name)),
    })),
  ]),
]);
