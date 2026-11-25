// STATISTIC: UnrolledLoopsEmitted >= 8
// Loops that are laid out several iterations at a time read elements for numbers: what is no int32, and a hole, stands at each place of the list in turn.
function plus(x: number): number { return x + 1; }
function cut(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s = (s + (list[i]! + 1)) | 0; return s; }
function named(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + (x - 1)) | 0; } return s; }
function called(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + plus(x)) | 0; } return s; }
function times(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s = (s * 31 + list[i]!) | 0; return s; }
function summed(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]! + 1; return s; }
function compared(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) if (list[i]! + 1 > 4) s += i + 1; return s; }
function equal(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) if (list[i]! + 1 === 5) s += i + 1; return s; }
function truthy(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) if (list[i]! * 2) s += i + 1; return s; }
function remainder(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) if ((list[i]! + 1) % 3 === 1) s += i + 1; return s; }
function bits(list: number[]): number { let s = 0; for (let i = 0; i < list.length; i++) s = (s ^ (list[i]! + 1)) | 0; return s; }
function shown(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
const odd: [string, unknown][] = [["a hole", 0], ["undefined", undefined], ["NaN", NaN], ["a fraction", 2.5], ["minus zero", -0], ["past an int32", 2 ** 40], ["the greatest int32", 2147483647], ["the least int32", -2147483648], ["endless", Infinity], ["null", null], ["a text", "12"], ["true", true], ["an object", { valueOf() { return 12; } }], ["a BigInt", 7n]];
for (const run of [cut, named, called, times, summed, compared, equal, truthy, remainder, bits]) {
  const plain: string[] = [];
  for (const length of [0, 1, 7, 8, 9, 24, 33]) plain.push(shown(run(Array.from({ length }, (_, i) => (i * 37) % 11 - 2))), shown(run(Array.from({ length }, (_, i) => i * 1.5 + 0.25))));
  console.log(run.name, plain.join(" "));
  for (const [name, value] of odd) {
    const said: string[] = [];
    for (let place = 0; place < 13; place++) {
      const list: unknown[] = Array.from({ length: 24 }, (_, i) => (i * 37) % 11 - 2);
      if (name === "a hole") delete list[place]; else list[place] = value;
      if (place & 1) list[23] = value;
      try { said.push(shown(run(list as number[]))); } catch (error) { said.push((error as Error).name); }
    }
    console.log(run.name, name, said.join(" "));
  }
}
