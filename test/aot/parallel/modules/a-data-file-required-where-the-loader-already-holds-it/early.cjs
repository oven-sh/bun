const show = (name, value) => console.log(name, Object.prototype.toString.call(value), Object.keys(value).join());
show("a level above, imported in front:", require("./in-front.json"));
show("a level above, imported behind:", require("./behind.json"));
show("a text, six levels down:", require("./note.txt"));
exports.later = () => show("six levels down, required when all is loaded:", require("./deep.json"));
