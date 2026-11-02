// A `--define` whose value is a dotted path reads a member of the `const` that the body of a namespace declares under its first name. `bun run` puts the value of that `const` in place of the variable and leaves the variable out, so the path finds the global of that name there. Plain Bun prints another output.
// Flags: --define COUNT=holder.length
declare const COUNT: unknown;
(globalThis as any).holder = "the global";
namespace Space {
  const holder = "abc";
  export const seen = COUNT;
}
console.log(Space.seen);

export {};
/* Output:
3
*/
