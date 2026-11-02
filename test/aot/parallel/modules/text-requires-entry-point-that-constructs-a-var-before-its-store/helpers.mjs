console.log("helpers begins");
try {
  new Function("url", "return process.getBuiltinModule('module').createRequire(url)('./derives.mjs')")(import.meta.url);
  console.log("text require returned");
} catch (error) {
  console.log("text require threw:", error.constructor.name, error.message);
}
export var Base = function () {
  this.size = 1;
};
console.log("helpers ends");
