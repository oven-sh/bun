// A `--define` whose value is a dotted path reads a member of a `const` of the CommonJS file that holds a string.
// Flags: --define ROOT=target.length
const target = "abc";
try {
  console.log(ROOT);
} catch (e) {
  console.log(e.constructor.name);
}
