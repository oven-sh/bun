// The text of a function has a `--define` value of one name where the defined name is written, as under `bun run`, also a longer one at its end.
// Flags: --define NAME=target
function read(target) {
  return NAME;
}
const last = (target, other) => NAME;
console.log(String(read));
console.log(String(last));
