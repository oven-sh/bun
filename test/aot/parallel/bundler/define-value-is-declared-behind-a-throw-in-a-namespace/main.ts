// `bun run` removes what the body of a namespace declares behind a `throw`: a `const`, a class and an enum. A `--define` whose value is such a name finds in front of the `throw` what lies further out. The build finds the declaration there, which never runs, and stops at the defined name.
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
/* Build errors:
error: TS100050: --aot does not support --define FIXED=fixed where "fixed" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'FIXED="fixed"'
error: TS100050: --aot does not support --define KIND=Kind where "Kind" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'KIND="Kind"'
error: TS100050: --aot does not support --define SHADE=shade where "shade" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'SHADE="shade"'
*/
