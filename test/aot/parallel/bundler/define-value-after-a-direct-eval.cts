// The first name of a `--define` value is looked up where the defined name is written in a TypeScript file too: the text of a direct eval in the function may have declared it.
// Flags: --define NAME=target --define ROOT=holder.value
declare const NAME: string;
declare const ROOT: string;
Object.assign(globalThis, { target: "the global", holder: { value: "the global" } });
function reads(text: string): string {
  eval(text);
  return [NAME, typeof NAME, ROOT].join(" | ");
}
console.log(reads(`var target = "declared by the text"; var holder = { value: "declared by the text" };`));
console.log(reads(""));
