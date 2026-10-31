// A `--define` whose value is one name calls the function of that name, which the file also names itself.
// Flags: --define NAME=target
declare const NAME: () => string;
function target(): string {
  return "the function of the file";
}
console.log(NAME(), typeof target);
export {};
