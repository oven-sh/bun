// Source that evaluated source evaluates is shown under the file that holds the outermost call.
globalThis.look = () => {
  const frames = new Error("here").stack.split("\n").slice(1, 6);
  console.log(frames.map(frame => frame.trim().replace(/[^ (]*\/(?=[^/]*$)/, "")).join("\n"));
  return 1;
};

function evalInEval() {
  return (0, eval)("(0, eval)('look()')");
}
function evalInFunction() {
  return new Function("return (0, eval)('look()')")();
}
function functionInEval() {
  return (0, eval)("new Function('return look()')()");
}
function functionInFunction() {
  return new Function("return new Function('return look()')()")();
}
function threeDeep() {
  return (0, eval)(`(0, eval)("(0, eval)('look()')")`);
}

for (const run of [evalInEval, evalInFunction, functionInEval, functionInFunction, threeDeep]) {
  console.log(run.name);
  run();
}

globalThis.fileOf = url => String(url).replace(/.*\//, "");
globalThis.fileOfCallSite = () => {
  const previous = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) => sites[1].getFileName();
  const file = fileOf(new Error("here").stack);
  Error.prepareStackTrace = previous;
  return file;
};
console.log((0, eval)(`(0, eval)("fileOf(new Error('here').sourceURL)")`));
console.log(new Function(`return new Function("return fileOf(new Error('here').sourceURL)")()`)());
console.log((0, eval)(`(0, eval)("[fileOfCallSite()][0]")`));
