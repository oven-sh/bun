// JavaScript in files whose extension names no loader, required where `bun build` does not link the call: the loader runs them, in an executable too.
const show = (name, load) => console.log(name, JSON.stringify(load()));
const load = require;
show("another name", () => load("./another-name.bin"));
show("require.call", () => require.call(null, "./require-call.conf"));
show("made", () => require("node:module").createRequire(__filename)("./made.plugin"));
show("once", () => load("./another-name.bin") === load("./another-name.bin"));
for (const name of ["code.bin", "prose.conf", "bytes.png", "script.sh", "code.js.map"]) {
  try {
    const found = require("./computed/" + name);
    console.log(
      "computed",
      name,
      typeof found === "string" ? found.replace(/^.*[\\/]|-[a-z0-9]{8}(?=\.)/g, "") : JSON.stringify(found),
    );
  } catch {
    console.log("computed", name, "throws");
  }
}
for (const fail of [() => load("./no-program.conf"), () => load("./no-program.png")]) {
  try {
    console.log(fail());
  } catch {
    console.log("no program: throws");
  }
}
show("shell script", () => load("./script.sh").replace(/^.*[\\/]|-[a-z0-9]{8}(?=\.)/g, ""));
require("./module.mjs");
