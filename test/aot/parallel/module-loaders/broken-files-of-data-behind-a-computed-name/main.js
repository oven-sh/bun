// A file of data that its parser refuses, and that only a computed name could load, stops no build: each load of it throws, and the files beside it load.
const tried = async (label, load) => {
  try {
    console.log(label, JSON.stringify((await load()).default));
  } catch (error) {
    console.log(label, "threw", typeof error.message);
  }
};
for (const name of ["good.json", "commented.json", "broken.toml"]) {
  await tried(name, () => import("./data/" + name));
  await tried(name + " once more", () => import("./data/" + name));
  await tried(name + " required", async () => ({ default: typeof require("./data/" + name) }));
}
