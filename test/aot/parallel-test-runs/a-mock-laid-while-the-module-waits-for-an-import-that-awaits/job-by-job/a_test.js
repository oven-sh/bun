// One step a job behind the call that waited: under `bun test` the factory has its original in the second job and the module is patched in the fourth.
import { test } from "bun:test";
globalThis.said = [];
test("a ruler", async () => {
  const marks = [];
  const done = new Promise(end => {
    const from = read => { let n = 0; const step = () => { marks.push(n + ":" + read() + ":" + globalThis.said.join("+")); if (++n < 12) Promise.resolve().then(step); else end(); }; step(); };
    import("./a1.mjs").then(found => from(() => found.v));
  });
  await done;
  let last = "";
  console.log("SAID", marks.filter(mark => { const what = mark.replace(/^[^:]*:/, ""); const isNew = what !== last; last = what; return isNew; }).join(" | "));
}, 4000);
