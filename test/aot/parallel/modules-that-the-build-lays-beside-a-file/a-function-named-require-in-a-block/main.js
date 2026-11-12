// Reference: bun build --compile
{
  function require() {}
}
const pages = import.meta.glob("./pages/*.cjs", { eager: true });
console.log(Object.keys(pages).join(), typeof pages["./pages/a.cjs"], pages["./pages/a.cjs"]?.default?.name);
module.exports = pages;
