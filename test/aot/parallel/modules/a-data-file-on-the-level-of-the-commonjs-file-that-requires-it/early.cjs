const show = (name, value) => console.log(name, Object.prototype.toString.call(value), Object.keys(value).join());
show("imported in front:", require("./in-front.json"));
show("imported behind:", require("./behind.json"));
