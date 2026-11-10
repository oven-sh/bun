const say = async (what, load) => {
  try {
    console.log("SAID", what, String((await load()).look()));
  } catch (error) {
    console.log("SAID", what, error.name);
  }
};
await say("wide.mjs flat whole", () => import("./whole0.mjs"));
await say("wide.mjs flat named", () => import("./named0.mjs"));
await say("wide.mjs flat import()", async () => { const all = await import("./wide.mjs"); return { look: () => all.flat + " " + Object.keys(all).filter(key => key !== "module.exports").join() }; });
await say("wide.mjs flat require", () => import("./needs0.cjs"));
await say("wide.mjs round whole", () => import("./whole1.mjs"));
await say("wide.mjs round named", () => import("./named1.mjs"));
await say("wide.mjs round import()", async () => { const all = await import("./wide.mjs"); return { look: () => all.round + " " + Object.keys(all).filter(key => key !== "module.exports").join() }; });
await say("wide.mjs round require", () => import("./needs1.cjs"));
await say("last.mjs flat whole", () => import("./whole2.mjs"));
await say("last.mjs flat named", () => import("./named2.mjs"));
await say("last.mjs flat import()", async () => { const all = await import("./last.mjs"); return { look: () => all.flat + " " + Object.keys(all).filter(key => key !== "module.exports").join() }; });
await say("last.mjs flat require", () => import("./needs2.cjs"));
await say("other.mjs round whole", () => import("./whole3.mjs"));
await say("other.mjs round named", () => import("./named3.mjs"));
await say("other.mjs round import()", async () => { const all = await import("./other.mjs"); return { look: () => all.round + " " + Object.keys(all).filter(key => key !== "module.exports").join() }; });
await say("other.mjs round require", () => import("./needs3.cjs"));
