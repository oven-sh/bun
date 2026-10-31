// A `const` in the body of a namespace is not at the top level of the file: `bun run` may put its value in place of the variable, and a `--define` whose value is a dotted path below it then finds the global of that name. The build stops at the path.
// Flags: --define COUNT=holder.length
declare const COUNT: unknown;
(globalThis as any).holder = "the global";
namespace Space {
  const holder = "abc";
  export const seen = COUNT;
}
console.log(Space.seen);

export {};
/* Build errors:
error: TS100050: --aot does not support --define COUNT=holder.length where "holder" is a let or const that is not at the top level of the file. The value is read as a name. A string needs quotes: --define 'COUNT="holder.length"'
*/
