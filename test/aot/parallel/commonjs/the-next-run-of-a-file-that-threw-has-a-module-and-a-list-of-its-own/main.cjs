for (let i = 0; i < 3; i++) {
  try {
    require("./above.cjs");
  } catch {}
}
const list = it => it.children.map(child => child.id.split("/").pop()).join("+") || "nothing";
console.log(globalThis.mods.map(list).join(" | "), new Set(globalThis.mods).size);
