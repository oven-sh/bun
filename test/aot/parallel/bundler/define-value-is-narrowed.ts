// A `--define` whose value is one name reads the parameter of that name each time, also where the program has narrowed the type of the defined name.
// Flags: --define NAME=target
declare const NAME: string | undefined;
function read(target: string | undefined): string {
  if (NAME) return NAME.toUpperCase();
  return typeof NAME;
}
console.log(read("bound"), read(undefined));
export {};
