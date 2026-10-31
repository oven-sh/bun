// In a TypeScript file too `bun run` removes a `const` that is declared behind a `return`, so a `--define` whose value is its name finds the global of that name in front of the `return`. The build finds the `const` there, which never runs, and stops at the defined name.
// Flags: --define NAME=target
declare const NAME: string;
(globalThis as any).target = "the global";
function read(): string {
  return NAME;
  const target = "never declared";
}
console.log(read());
export {};
/* Build errors:
error: TS100050: --aot does not support --define NAME=target where "target" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'NAME="target"'
*/
