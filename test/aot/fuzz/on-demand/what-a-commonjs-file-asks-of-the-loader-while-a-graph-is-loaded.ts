import { generated } from "../../generated/run-generated";
import {
  asked,
  type Case,
  cases,
  loaders,
  make,
  nameOf,
  places,
  watchers,
} from "../../generated/what-a-commonjs-file-asks-of-the-loader-while-a-graph-is-loaded";

// The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
const plainEnv = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

// Every run takes each loader with each thing that is asked for once, and goes through the places and the watchers meanwhile. AOT_GENERATED=all takes every combination.
const numberIn = (list: object, name: string) => Object.keys(list).indexOf(name);
const isAlwaysRun = ([loader, place, what, watcher]: Case) => {
  const turn = numberIn(loaders, loader) + numberIn(asked, what);
  const count = (list: object) => Object.keys(list).length;
  return (
    numberIn(places, place) === turn % count(places) &&
    numberIn(watchers, watcher) === (turn + numberIn(places, place)) % count(watchers)
  );
};

generated(
  "what a CommonJS file asks of the loader while a graph is loaded",
  cases.map(given => ({
    name: nameOf(given),
    isAlwaysRun: isAlwaysRun(given),
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    plainEnv,
    make: () => make(given),
  })),
);
