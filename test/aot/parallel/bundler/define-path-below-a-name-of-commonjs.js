// A `--define` whose value is a dotted path below `__dirname`, `__filename`, `require`, `module`, `exports` or `arguments` does not make a `.js` file a CommonJS file: each path reads the global of its first name, and there is none.
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
