// In a TypeScript file a `--define` whose value is one name reads a `const` of the file and a parameter. The build stops where a defined name whose value is `eval` is called.
// Flags: --define NAME=target --define RUN=eval --define import.meta.env.MODE=mode
declare const NAME: string;
declare const RUN: typeof eval;
const target = "the binding of the file";
function read(mode: string): string {
  return (import.meta as any).env.MODE + mode;
}
console.log(NAME, RUN("1"), read("a parameter"));

export {};
/* Build errors:
error: TS100050: --aot does not support --define RUN=eval where RUN is called. The value is read as a name. A string needs quotes: --define 'RUN="eval"'
*/
