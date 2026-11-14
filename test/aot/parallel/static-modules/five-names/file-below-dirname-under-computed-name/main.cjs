// `__dirname + "/plugins/" + name + ".js"`: the build knows the folder, so its files are in the executable, and the text that the program makes
// of `__dirname` at run time finds them.
const row = (name, load) => {
  try {
    console.log(name, JSON.stringify(load()));
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};
const names = ["first", "second"];
for (const name of names) {
  row("a sum", () => require(__dirname + "/plugins/" + name + ".js"));
  row("a template", () => require(`${__dirname}/plugins/${name}.js`));
  row("without the extension", () => require(__dirname + "/plugins/" + name));
}
row("up and down again", () => require(__dirname + "/sub/../plugins/" + names[0] + ".js"));
row("in a file of a folder below", () => require("./sub/loads.cjs")(names[1]));
row("one object for both spellings", () => require(__dirname + "/plugins/" + names[0] + ".js") === require("./plugins/first.js"));
row("no such file", () => require(__dirname + "/plugins/" + "thi" + names[0].slice(0, 0) + "rd.js"));
import(__dirname + "/plugins/" + names[1] + ".js").then(loaded => console.log("import()", loaded.default.name));
