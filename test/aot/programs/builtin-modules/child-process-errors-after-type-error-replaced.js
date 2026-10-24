// node:child_process creates its errors from the realm's own TypeError, not from a class that the program stores in `globalThis.TypeError` before it requires the module.
const RealTypeError = TypeError;
globalThis.TypeError = class Fake extends Error {};
const childProcess = require("node:child_process");

function attempt(label, run) {
  try {
    run();
    console.log(label, "returns");
  } catch (error) {
    console.log(label, error.constructor.name, error.constructor === RealTypeError, error instanceof TypeError, error.name, error.code, error.message);
  }
}

attempt("spawn", () => childProcess.spawn("ls", [], { killSignal: "SIGNOPE" }));
attempt("spawnSync", () => childProcess.spawnSync("ls", [], { killSignal: "SIGNOPE" }));
attempt("execFile", () => childProcess.execFile("ls", [], { killSignal: "SIGNOPE" }));
attempt("the program's own", () => {
  const Replaced = globalThis.TypeError;
  throw new Replaced("from the program");
});
