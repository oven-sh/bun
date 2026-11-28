import * as code from "./code.mjs" with { type: "js" };
const show = async load => {
  try {
    console.log(Object.keys(await load()).join());
  } catch (error) {
    console.log(error.name);
  }
};
const kind = globalThis.never ?? "js";
await show(() => import("./code.mjs", { with: { type: "text" } }));
await show(() => import("./code.mjs", { with: { type: kind } }));
console.log(Object.keys(code).join());
