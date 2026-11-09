// A CommonJS file that throws while it loads has not run: whoever asks for it next runs it again. Each file here throws in its first run and is asked for twice.
// The build sees a written require(). It does not see what a require() loads that was handed over, or made over a path that it cannot work out.
const made = require("node:module").createRequire(require.resolve("./made.cjs"));
const madeOverTheAsker = require("node:module").createRequire(__filename);
const handedOver = [require][JSON.parse("0")];
console.log(typeof require.resolve("./handed-over.cjs"), typeof require.resolve("./of-the-main-module.cjs"));
globalThis.threw = {};
try {
  console.log("made, first:", Object.keys(made("./made.cjs")).join());
} catch (error) {
  console.log("made, first: threw", error.name);
}
try {
  console.log("made, second:", Object.keys(made("./made.cjs")).join());
} catch (error) {
  console.log("made, second: threw", error.name);
}
try {
  console.log("made-over-the-asker, first:", Object.keys(madeOverTheAsker("./made-over-the-asker.cjs")).join());
} catch (error) {
  console.log("made-over-the-asker, first: threw", error.name);
}
try {
  console.log("made-over-the-asker, second:", Object.keys(madeOverTheAsker("./made-over-the-asker.cjs")).join());
} catch (error) {
  console.log("made-over-the-asker, second: threw", error.name);
}
try {
  console.log("handed-over, first:", Object.keys(handedOver("./handed-over.cjs")).join());
} catch (error) {
  console.log("handed-over, first: threw", error.name);
}
try {
  console.log("handed-over, second:", Object.keys(handedOver("./handed-over.cjs")).join());
} catch (error) {
  console.log("handed-over, second: threw", error.name);
}
try {
  console.log("of-the-main-module, first:", Object.keys(require.main.require("./of-the-main-module.cjs")).join());
} catch (error) {
  console.log("of-the-main-module, first: threw", error.name);
}
try {
  console.log("of-the-main-module, second:", Object.keys(require.main.require("./of-the-main-module.cjs")).join());
} catch (error) {
  console.log("of-the-main-module, second: threw", error.name);
}
try {
  console.log("written, first:", Object.keys(require("./written.cjs")).join());
} catch (error) {
  console.log("written, first: threw", error.name);
}
try {
  console.log("written, second:", Object.keys(require("./written.cjs")).join());
} catch (error) {
  console.log("written, second: threw", error.name);
}
try {
  console.log("written-then-handed-over, first:", Object.keys(require("./written-then-handed-over.cjs")).join());
} catch (error) {
  console.log("written-then-handed-over, first: threw", error.name);
}
try {
  console.log("written-then-handed-over, second:", Object.keys(handedOver("./written-then-handed-over.cjs")).join());
} catch (error) {
  console.log("written-then-handed-over, second: threw", error.name);
}
try {
  console.log("handed-over-then-written, first:", Object.keys(handedOver("./handed-over-then-written.cjs")).join());
} catch (error) {
  console.log("handed-over-then-written, first: threw", error.name);
}
console.log("handed-over-then-written, second:", Object.keys(require("./handed-over-then-written.cjs")).join());
