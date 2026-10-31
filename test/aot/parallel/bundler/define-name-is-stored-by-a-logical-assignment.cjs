// `||=`, `&&=` and `??=` read and store through a defined name whose `--define` value is one name to the `let` of the file that has that name, and store only where the operator asks for it.
// Flags: --define NAME=target
let target = 0;
const results = [];
results.push((NAME ||= 1), target);
results.push((NAME ||= 2), target);
results.push((NAME &&= 3), target);
target = null;
results.push((NAME &&= 4), target);
results.push((NAME ??= 5), target);
results.push((NAME ??= 6), target);
console.log(results.map(String).join(" "), typeof globalThis.target);
