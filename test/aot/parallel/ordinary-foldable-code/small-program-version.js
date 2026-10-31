const VERSION = "2.14.3";
const [major, minor, patch] = VERSION.split(".").map(Number);
const isLegacy = major < 2;
const label = `v${major}.${minor}` + (patch ? `.${patch}` : "");
console.log(major, minor, patch, isLegacy, label);
console.log(major >= 2 && minor >= 10 ? "supports streams" : "no streams");
