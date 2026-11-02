// A `--define` whose value is a dotted path below `__dirname`, `__filename`, `require`, `module`, `exports` or `arguments` does not make a `.js` file a CommonJS file. The file is an ES module, and each path reads what such a module has under its first name: nothing has the name `module`, `exports` or `arguments` there. `bun run` finds no variable for any of the six paths. Plain Bun prints another output.
// Flags: --define DL=__dirname.length --define FL=__filename.length --define RR=require.resolve --define ME=module.exports --define EK=exports.k --define AL=arguments.length
const t = f => {
  try {
    return typeof f();
  } catch (e) {
    return e.constructor.name;
  }
};
console.log(
  t(() => DL),
  t(() => FL),
  t(() => RR),
  t(() => ME),
  t(() => EK),
  t(() => AL),
);
/* Output:
number number function ReferenceError ReferenceError ReferenceError
*/
