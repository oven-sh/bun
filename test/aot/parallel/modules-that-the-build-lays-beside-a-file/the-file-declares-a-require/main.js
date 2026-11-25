// Reference: bun build --compile
var require = name => ({ entry: "the own require of the file got " + name });
const pages = import.meta.glob("./pages/*.cjs", { eager: true });
console.log(Object.keys(pages).join(), typeof pages["./pages/a.cjs"], pages["./pages/a.cjs"]?.default?.name);
module.exports = pages;
