// A store through a defined name whose `--define` value names a `const` of the file throws a TypeError where the store runs, behind the value: the file is built and the statements around the store run.
// Flags: --define NAME=target
const target = 0;
const seen = [];
function attempt(store) {
  try {
    store();
    seen.push("no error");
  } catch (error) {
    seen.push(error.constructor.name);
  }
}
attempt(() => (NAME = (seen.push("the value"), 1)));
attempt(() => NAME++);
attempt(() => (NAME += 2));
attempt(() => ([NAME] = [3]));
attempt(() => {
  for (NAME of [4]);
});
attempt(() => (NAME ||= 5));
attempt(() => (NAME &&= 6));
console.log(seen.join(" "), target, typeof globalThis.target);
