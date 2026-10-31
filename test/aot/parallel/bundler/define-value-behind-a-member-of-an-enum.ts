// Inside an enum a member of the enum is no variable, so a `--define` whose value is the name of a member reads the variable of that name around the enum. `bun run` counts no use of that variable there and may leave out a `let` or `const` that nothing else reads: the build stops at such a name.
// Flags: --define NAME=target
declare const NAME: any;
(globalThis as any).target = "the global";
function read(): unknown {
  const target = "the const of the function";
  enum Kind {
    target = 5,
    seen = NAME as any,
  }
  return Kind.seen;
}
console.log(read());

export {};
/* Build errors:
error: TS100050: --aot does not support --define NAME=target where "target" is a let or const that is not at the top level of the file. The value is read as a name. A string needs quotes: --define 'NAME="target"'
*/
