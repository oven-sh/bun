const show = async load => {
  try {
    console.log(Object.keys(await load()).join());
  } catch (error) {
    console.log(error.name);
  }
};
await show(() => import("./code.mjs", { with: { type: "js" } }));
await show(() => import("./code.mjs"));
await show(() => import("./code.mjs", { with: { type: "text" } }));
