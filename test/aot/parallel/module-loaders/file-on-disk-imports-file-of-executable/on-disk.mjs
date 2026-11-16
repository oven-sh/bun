import * as counter from "./counter.mjs";
import { bump } from "./counter.mjs";
import { twice } from "./pairs.mjs";
console.log(
  "the file on disk sees",
  counter.count,
  bump === globalThis.bumpOfProgram,
  twice(),
  Object.keys(counter).join(),
);
