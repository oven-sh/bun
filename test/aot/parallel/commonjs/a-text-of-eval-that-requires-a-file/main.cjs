// A direct eval of a require() with a written path, as code that hides a require() from bundlers has it: the file's own require is called.
const said = [];
const lazy = () => eval("require('./counted.cjs')");
said.push("before");
said.push(lazy().count(), lazy().count());
said.push(eval('require("./other.cjs")').name, eval(" require ( './other.cjs' ) ; ") === require("./other.cjs"));
said.push(eval("require('node:path')").join === require("path").join);
try {
  eval("require('./missing.cjs')");
} catch (error) {
  said.push(error.code);
}
said.push(require("./shadowed.cjs")(path => "given " + path), require("./declared.cjs"));
try {
  said.push((0, eval)("typeof require"), typeof (0, eval)("require('./other.cjs')"));
} catch (error) {
  said.push(error.name);
}
class Holder {
  static loaded = eval("require('./other.cjs')").name;
  load() {
    return eval("require('./counted.cjs')").count();
  }
}
said.push(Holder.loaded, new Holder().load());
console.log(said.join());
