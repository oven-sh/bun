const say = async (what, load) => {
  try {
    console.log("SAID", what, String((await load()).look()));
  } catch (error) {
    console.log("SAID", what, error.name);
  }
};
await say("one star", () => import("./reader0.mjs"));
await say("two stars in a row", () => import("./reader1.mjs"));
await say("a CommonJS star beside it", () => import("./reader2.mjs"));
await say("by name", () => import("./reader3.mjs"));
