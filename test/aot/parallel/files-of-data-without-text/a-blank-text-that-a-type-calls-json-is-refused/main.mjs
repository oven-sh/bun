const say = async (how, load) => {
  try {
    const all = await load();
    console.log("SAID", how, typeof all.default, JSON.stringify(all.default));
  } catch (error) {
    console.log("SAID", how, "threw", error.name, "|", error.message);
  }
};
await say("0 bytes", () => import("./nothing.txt", { with: { type: "json" } }));
await say("blanks", () => import("./blanks.txt", { with: { type: "json" } }));
await say("with text", () => import("./full.txt", { with: { type: "json" } }));
