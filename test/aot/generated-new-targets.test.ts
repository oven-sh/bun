import { programsByOrigin } from "./generated/new-targets";
import { generated } from "./generated/run-generated";

const alwaysRun = new Set([
  "class.extends",
  "class.factory-twice",
  "class.extends-picked",
  "class.reflect-class",
  "class.super-after-set-prototype-of",
  "function.two-levels",
  "function.reflect-subclass",
]);

generated(
  "the object a constructor allocates belongs to new.target",
  [
    { title: "constructed once", programs: programsByOrigin(["once"], ["direct"]) },
    { title: "read by one function", programs: programsByOrigin(["shared"], ["generic"]) },
    { title: "in a loop beside the base", programs: programsByOrigin(["loop"], ["direct"]) },
    { title: "never handed to a built-in", programs: programsByOrigin(["function"], ["local"]) },
    { title: "copied and listed by built-ins", programs: programsByOrigin(["once"], ["copied"]) },
    { title: "in the callback of forEach", programs: programsByOrigin(["in-for-each"], ["direct"]) },
  ].flatMap(({ title, programs }) =>
    programs.map(({ name, text }) => ({
      name: `${name}, ${title}.`,
      isAlwaysRun: alwaysRun.has(name) && (title === "constructed once" || title === "read by one function"),
      // One of its constructors answers with a promise of `this`. There the prototype of `this` is such a promise, so `then` is found on what is no promise, and nobody handles the rejection.
      ...(name.endsWith(".apply-with-instance-as-prototype") && { leavesAnError: true as const }),
      make: () => ({ file: "main.js", text }),
    })),
  ),
);
