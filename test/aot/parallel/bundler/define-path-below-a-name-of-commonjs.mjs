// In an ES module a `--define` whose value is a dotted path below `__dirname`, `__filename`, `require`, `module`, `exports` or `arguments` reads the global of that name, and there is none.
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
export {};
