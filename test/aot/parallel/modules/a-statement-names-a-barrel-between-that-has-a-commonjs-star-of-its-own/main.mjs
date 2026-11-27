const say = async (what, load) => {
  try {
    console.log("SAID", what, String((await load()).look()));
  } catch (error) {
    console.log("SAID", what, error.name);
  }
};
await say("amid.mjs round whole", () => import("./whole0.mjs"));
await say("amid.mjs round named", () => import("./named0.mjs"));
await say("amid.mjs round import()", async () => { const all = await import("./amid.mjs"); return { look: () => all.round + " " + Object.keys(all).filter(key => key !== "module.exports").join() }; });
await say("amid.mjs round require", () => import("./needs0.cjs"));
await say("last.mjs round whole", () => import("./whole1.mjs"));
await say("last.mjs round named", () => import("./named1.mjs"));
await say("last.mjs round import()", async () => { const all = await import("./last.mjs"); return { look: () => all.round + " " + Object.keys(all).filter(key => key !== "module.exports").join() }; });
await say("last.mjs round require", () => import("./needs1.cjs"));
await say("wide.mjs round whole", () => import("./whole2.mjs"));
await say("wide.mjs round named", () => import("./named2.mjs"));
await say("wide.mjs round import()", async () => { const all = await import("./wide.mjs"); return { look: () => all.round + " " + Object.keys(all).filter(key => key !== "module.exports").join() }; });
await say("wide.mjs round require", () => import("./needs2.cjs"));
