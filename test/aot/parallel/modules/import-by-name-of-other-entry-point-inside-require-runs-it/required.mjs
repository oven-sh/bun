console.log("required begins");
new Function("name", "return import(name)")(import.meta.resolve("./other-entry.mjs")).then(() => console.log("import of other-entry: fulfilled"));
console.log("required ends");
export {};
