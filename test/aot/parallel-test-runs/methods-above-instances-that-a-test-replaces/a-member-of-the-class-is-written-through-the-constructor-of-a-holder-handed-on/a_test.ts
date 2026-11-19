import { test } from "bun:test";
import * as roads from "./roads";
// The holder above all objects is handed on by its name. That opens its own members and not those of Object, to which its `constructor` leads. Whoever goes that way is followed:
// a member of Object written at the end of it, under a name that is made in the run, is replaced as in plain Bun.
test("a member of the class is written through the constructor of the holder that is handed on", () => {
  const keys = roads.put(roads.aboveAll.constructor, roads.named("ke", "ys"), () => ["replaced"]);
  console.log("replaced:", Object.keys({ a: 1 }));
  roads.put(roads.aboveAll.constructor, roads.named("ke", "ys"), keys);
  console.log("put back:", Object.keys({ a: 1 }));
  const own = roads.put(roads.aboveAll, roads.named("to", "String"), function () { return "replaced"; });
  console.log("its own:", String({}));
  roads.put(roads.aboveAll, roads.named("to", "String"), own);
  console.log("put back:", String({}));
});
