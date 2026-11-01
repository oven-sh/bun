// Reference: bun build --compile
console.log("body", typeof module, typeof import.meta.glob);
const lazy = import.meta.glob("./pages/*.ts");
console.log(Object.keys(lazy).join());
const eager = import.meta.glob("./pages/*.ts", { eager: true, import: "name" });
console.log(
  JSON.stringify(eager),
  Object.keys(import.meta.glob("./pages/a.ts", { eager: true })["./pages/a.ts"]).join(),
);
lazy["./pages/b.ts"]().then(page => console.log(page.name));
module.exports = eager;
