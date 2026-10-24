export const lines: string[] = ["inner runs"];
const pending: Promise<unknown>[] = [];
export function settled(): Promise<unknown> {
  return Promise.all(pending);
}

const attempt = (run: () => unknown) => {
  try {
    return run();
  } catch (error) {
    return (error as Error).constructor.name;
  }
};

const around = require("./around") as typeof import("./around");
lines.push("required around: " + [around.nameOfAround(), around.first.join(" "), around.lines === lines, attempt(() => around.late), attempt(() => around.last)].join(", "));
const outer = require("./outer") as typeof import("./outer");
lines.push("required outer: " + [outer.nameOfOuter(), outer.nameOfAround(), attempt(() => outer.late), attempt(() => outer.last)].join(", "));
lines.push("keys: " + Object.getOwnPropertyNames(outer).join());

pending.push(Promise.resolve().then(() => lines.push("a job queued before the imports")));
pending.push(import("./around").then(namespace => lines.push("imported around: " + [namespace.late, namespace.last, namespace.lines === lines].join(", "))));
pending.push(import("./outer").then(namespace => lines.push("imported outer: " + [namespace.late, namespace.last, namespace.nameOfOuter()].join(", "))));
pending.push(Promise.resolve().then(() => lines.push("a job queued behind the imports")));

export const late = "late";
lines.push("required again: " + [around.late, outer.late, attempt(() => around.last)].join(", "));
