// An object is filled under the keys of the module "bun". plugin is read under its name on that object and called.
const copy = {};
const bun = require("bun");
for (const key of Object.keys(bun)) copy[key] = bun[key];
copy.plugin({
  name: "a plugin that does nothing",
  setup(build) {
    console.log(typeof build.onLoad);
  },
});
