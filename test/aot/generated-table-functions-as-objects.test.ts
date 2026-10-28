import { programsOf } from "./generated/case-files";
import { looksAtFunctions, looksAtHolders } from "./generated/functions-as-objects";
import { generated } from "./generated/run-generated";

generated(
  "a function is looked at as an object",
  programsOf(looksAtFunctions(), {
    alone: 150,
    // The host calls a class without `new`.
    leaveAnError: /^class (timer|microtask|next-tick|listener|executor)$/,
  }),
);
generated("an object that holds a function is looked at", programsOf(looksAtHolders(), { alone: 60 }));
