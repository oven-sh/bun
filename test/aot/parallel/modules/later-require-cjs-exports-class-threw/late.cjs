setTimeout(() => {
  const Thing = require("./file.cjs");
  try { console.log(new Thing().hello()); } catch (error) { console.log("new throws", error.name); }
  console.log(typeof Thing, typeof Thing.default, new Thing.default().hello(), Thing.made, Thing.default.made, Object.keys(Thing).join());
}, 1);
