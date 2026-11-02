console.log("helpers begins");
try {
  new Function("url", "return process.getBuiltinModule('module').createRequire(url)('./calls.mjs')")(import.meta.url);
  console.log("text require returned");
} catch (error) {
  console.log("text require threw:", error.constructor.name, error.message);
}
export var once = run => {
  let result;
  return () => (result ??= run());
};
console.log("helpers ends");
