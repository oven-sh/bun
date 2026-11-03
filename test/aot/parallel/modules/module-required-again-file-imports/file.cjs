console.log("file begins");
const { second } = require("./module.mjs");
const whole = require("./module.mjs");
const show = label =>
  console.log(
    label,
    second,
    Object.keys(whole).join(),
    whole.second,
    require("./module.mjs").second,
    whole === require("./module.mjs"),
  );
show("file has");
globalThis.later = () => show("file has later");
console.log("file ends");
