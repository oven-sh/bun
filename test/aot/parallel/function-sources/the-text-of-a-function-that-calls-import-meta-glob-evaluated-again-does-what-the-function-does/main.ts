// The build expands a call of import.meta.glob(), as `bun run` does, and the text of the function around it holds what was written in its place.
// Until then the text held the call as written: evaluated again it did not parse ("import.meta is only valid inside modules").
function lazy(): any {
  return import.meta.glob("./things/*.ts");
}
function names(): any {
  return import.meta.glob<string>("./things/*.ts", { import: "name" });
}
function keys(): string[] {
  return Object.keys(import.meta.glob("./things/*.ts", { eager: true }));
}
function eager(): any {
  return import.meta.glob("./things/*.ts", { eager: true, import: "name" });
}
const refused = () => import.meta.glob<string>(/* ( */ (globalThis as any).pattern);
const again = (text: unknown): any => (0, eval)("(" + text + ")");

console.log(Object.keys(again(lazy)()).join());
console.log(Object.keys(again(names)()).join());
console.log(again(keys)().join());
for (const ask of [eager, refused])
  try {
    console.log(again(ask)());
  } catch (error: any) {
    console.log(error.name);
  }
console.log(JSON.stringify(eager()), await names()["./things/two.ts"]());

// The functions that the build wrote have texts of their own.
const entry = names()["./things/one.ts"];
console.log(typeof again(entry), String(entry).includes("two.ts"), String(entry).includes("glob"));
