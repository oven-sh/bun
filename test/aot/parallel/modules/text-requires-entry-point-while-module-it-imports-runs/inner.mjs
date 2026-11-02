console.log("inner begins");
try {
  new Function("url", "return process.getBuiltinModule('module').createRequire(url)('./second.mjs')")(import.meta.url);
  console.log("text require returned");
} catch (error) {
  console.log("text require threw:", error.constructor.name, error.message);
}
export let value = { port: 8080 };
console.log("inner ends");
