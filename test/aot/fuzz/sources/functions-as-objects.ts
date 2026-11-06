// A function is looked at as an object, and so is an object that holds a function: its own keys, its name and length, what defining, deleting and freezing does to it.
import { programsOf } from "../generators/case-files";
import { looksAtFunctions, looksAtHolders } from "../generators/functions-as-objects";
import { family } from "../family";

export default family("a function is looked at as an object", [
  ...programsOf(looksAtFunctions(), {
    alone: 150,
    // The host calls a class without `new`.
    leaveAnError: /^class (timer|microtask|next-tick|listener|executor)$/,
  }),
  ...programsOf(looksAtHolders(), { alone: 60 }),
]);
