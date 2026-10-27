// docs/compiler/compatibility.mdx: a built-in module is one module, whatever the attributes of the import say and whether they are written or made at run time. Plain Bun has a namespace object for each kind of type.
import * as listed from "node:path" with { type: "json" };
const made = text => text.split("").join("");
const plain = await import("node:path");
const loads = {
  "a statement with json": () => listed,
  "json": () => import("node:path", { with: { type: "json" } }),
  "json made": () => import("node:path", { with: { type: made("json") } }),
  "json, the name made": () => import(made("node:path"), { with: { type: made("json") } }),
  "text": () => import("node:path", { with: { type: "text" } }),
  "text, the name made": () => import(made("node:path"), { with: { type: made("text") } }),
  "no type, the name made": () => import(made("node:path")),
};
for (const [what, load] of Object.entries(loads)) {
  const loaded = await load();
  console.log(what + ":", loaded === plain, loaded.default === plain.default, loaded.join === plain.join);
}
