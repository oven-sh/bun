console.log("second is evaluated");
const attempt = (run: () => unknown) => {
  try {
    return run();
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
export const seen: string[] = [];
seen.push("member " + attempt(() => require("./first").late) + " " + attempt(() => require("./first").hoisted()));
seen.push("pattern " + attempt(() => { const { late } = require("./first"); return late; }) + " " + attempt(() => { const { hoisted } = require("./first"); return hoisted(); }));
const first = require("./first") as typeof import("./first");
seen.push("held " + attempt(() => first.late) + " " + attempt(() => first.hoisted()) + " " + attempt(() => first.changing));
export function later() {
  return first.late;
}
