// `require.main === module` is answered by whether the file is the entry point, as long as the two names hold what the file was handed.
module = { id: "local" };
if (require.main === module) console.log("main");
else console.log("not main");
console.log(module === require.main, require.main == module, require.main !== module, module.id);
