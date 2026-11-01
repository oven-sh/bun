// A list of programs from ../generators/functions-as-objects.ts, which describes them.
import { programsOf } from "../generators/case-files";
import { looksAtFunctions, looksAtHolders } from "../generators/functions-as-objects";
import { family } from "../family";

export default family("functions as objects", [
  ...programsOf(looksAtFunctions(), {
    alone: 150,
    // The host calls a class without `new`.
    leaveAnError: /^class (timer|microtask|next-tick|listener|executor)$/,
  }),
  ...programsOf(looksAtHolders(), { alone: 60 }),
]);
