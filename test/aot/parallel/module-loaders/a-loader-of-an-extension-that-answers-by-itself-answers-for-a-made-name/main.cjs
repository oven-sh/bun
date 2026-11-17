require.extensions[".js"] = function (module, filename) { module.exports = { value: "from the hook" }; };
if (process.argv.length > 99) require("./subject.js");
console.log(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js").value);
