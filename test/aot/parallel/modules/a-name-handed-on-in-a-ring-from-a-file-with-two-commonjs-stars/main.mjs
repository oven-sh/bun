const say = async (what, load) => {
  try {
    console.log("SAID", what, String((await load()).look()));
  } catch (error) {
    console.log("SAID", what, error.name);
  }
};
await say("last.round", () => import("./reader0.mjs"));
await say("wide.round", () => import("./reader1.mjs"));
await say("import of last", () => import("./reader2.mjs"));
await say("import of wide", () => import("./reader3.mjs"));
await say("names", () => import("./reader4.mjs"));
