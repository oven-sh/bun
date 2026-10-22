// A parameter of a sloppy function that received no argument is stored in the mapped `arguments` object past its length and is not an element of it. Functions with 1, 4 and 40 parameters; the same bodies in a strict file and with a default parameter are not mapped.
import * as groups from "./sloppy.cjs";
import * as strictBodies from "./strict.cjs";
for (const name of Object.keys(groups).sort()) {
  const group = (groups as any)[name];
  if (!Array.isArray(group?.counts)) continue;
  for (const kind of ["sloppy", "strict", "withDefault"]) {
    const body = kind === "strict" ? (strictBodies as any)[name] : group[kind];
    for (const count of group.counts) {
      const list = Array.from({ length: count }, (_, index) => "argument " + index);
      console.log(name + "." + kind + " with " + count + ": " + JSON.stringify(body(...list)));
    }
  }
}
console.log("last allocation: " + (groups as any).lastAllocation());
