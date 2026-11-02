// A `--define` whose value is the name of a `const`, a class or an enum that the body of a namespace declares behind a `throw` names that declaration: the read in front of the `throw` throws a ReferenceError, and the namespace never comes to its `throw`. `bun run` removes what is declared behind the `throw` and finds what lies further out. Plain Bun prints another output.
// Flags: --define FIXED=fixed --define KIND=Kind --define SHADE=shade
for (const name of ["fixed", "Kind", "shade"]) {
  (globalThis as any)[name] = "the global";
}
let thrown: unknown = "nothing";
try {
  await import("./space");
} catch (error) {
  thrown = error;
}
console.log(thrown, "|", (globalThis as any).seen);
/* Output:
ReferenceError: Cannot access 'fixed' before initialization.
      at /$bunfs/root/space.ts:3:31
 | undefined
*/
