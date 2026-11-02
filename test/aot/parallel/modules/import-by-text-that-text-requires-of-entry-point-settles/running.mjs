console.log("running begins");
new Function("url", "process.getBuiltinModule('module').createRequire(url)('./other.mjs')")(import.meta.url);
console.log("running ends");
export const ended = true;
