// Reference: bun build --compile

const pages = import.meta.glob("./pages/*.cjs", { eager: true });
console.log(Object.keys(pages).join(), typeof pages["./pages/a.cjs"], pages["./pages/a.cjs"]?.default?.name);
module.exports = pages;
try {
  console.log(Object.keys(require("%glob::./pages/a.cjs")));
} catch {
  console.log("threw");
}
