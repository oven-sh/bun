// A `--define` whose value is one name calls the function of the file that has that name, which nothing else calls.
// Flags: --define NAME=target
declare const NAME: () => string;
function target(): string {
  return "the function of the file";
}
console.log(NAME());
export {};
