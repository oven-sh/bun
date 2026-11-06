// Each line: the frames that a file sees while a require() of a name that is made at run time runs it: the function of the host stands between the file and the requirer, under one name for a CommonJS file and under another for an ES module.
// Entry points: ./a.cjs ./b.mjs ./c.cjs ./d.mjs
globalThis.show = function show(label) {
  console.log(
    label,
    "|",
    new Error().stack
      .split("\n")
      .slice(1)
      .map(line =>
        line
          .trim()
          .slice(3)
          .replace(/[^ ()]*[\/\\]([\w.-]+:\d+:\d+)/, "$1"),
      )
      .join(" < "),
  );
};
const names = JSON.parse(process.env.NAMES ?? '["./a.cjs","./b.mjs","./c.cjs","./d.mjs"]');
function unknownName() {
  const first = require(names[0]);
  const second = require(names[1]);
  return [first, second];
}
function handed(load) {
  const first = load(names[2]);
  const second = load(names[3]);
  return [first, second];
}
unknownName();
handed(globalThis.id ? globalThis.id(require) : require);
