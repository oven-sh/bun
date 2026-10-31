const show = (name, value) => console.log(name, Object.prototype.toString.call(value), Object.keys(value).join());
show("a level below, imported in front:", require("./below-in-front.json"));
show("a level below, imported behind:", require("./below-behind.json"));
show("a level below, of the level above:", require("./in-front.json"));
