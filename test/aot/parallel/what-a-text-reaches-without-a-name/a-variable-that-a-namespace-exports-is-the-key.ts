// A variable that a namespace exports is a property of the namespace: whoever has the namespace stores into it, and no store under its name shows that.
namespace Cursor {
  export let slot: any = 0;
  export const pick = (list: any) => list[slot];
}
Cursor.slot = process.argv[2] ?? "flatMap";
console.log(Cursor.pick([1, 2]).call([1, 2], (n: number) => [n, n]));
