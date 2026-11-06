import { family } from "../family";
import {
  asked,
  type Case,
  cases,
  loaders,
  make,
  nameOf,
  places,
  watchers,
} from "../generators/what-a-commonjs-file-asks-of-the-loader-while-a-graph-is-loaded";

// The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
const plainEnv = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

const numberIn = (list: object, name: string) => Object.keys(list).indexOf(name);

export default family(
  "what a CommonJS file asks of the loader while a graph is loaded",
  cases.map(given => ({
    name: nameOf(given),
    plainEnv,
    make: () => make(given),
  })),
);
