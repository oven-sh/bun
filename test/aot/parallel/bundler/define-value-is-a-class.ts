// A `--define` whose value is one name constructs the class of the file that has that name, which nothing else names.
// Flags: --define MAKE=target
declare const MAKE: new () => { name: string };
class target {
  name = "the class of the file";
}
console.log(new MAKE().name);
export {};
