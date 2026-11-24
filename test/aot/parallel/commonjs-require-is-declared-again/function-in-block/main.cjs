console.log(typeof require, require("./dep.cjs").name);
{
  function require() {
    return { name: "block" };
  }
}
console.log(require("./dep.cjs").name);
