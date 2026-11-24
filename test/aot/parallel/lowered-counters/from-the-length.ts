// Counters that start at the length itself: the first iteration stores at the length, and the list grows there.
function shifted(a: number[]): any { for (let i = a.length; i > 0; i--) a[i] = a[i - 2]!; return a; }
function shiftedByOne(a: number[]): any { for (let i = a.length; i > 0; i--) a[i] = a[i - 1]!; return a; }
function asked(a: number[]): any { for (let i = a.length; i > 0; i--) if (a[i - 2]! > a[i]!) a[i] = a[i - 2]!; return a; }
function read(a: number[]): number { let n = 0; for (let i = a.length; i >= 0; i--) n += a[i] ?? 100; return n; }
function doubled(a: number[]): any { for (let i = a.length; i >= 0; --i) a[i] = (a[i - 1] ?? 0) * 0.5; return a; }
function views(a: Uint8Array): string { for (let i = a.length; i > 0; i--) a[i] = a[i - 1]!; return a.join(); }
function readViews(a: Float64Array): number { let n = 0; for (let i = a.length; i >= 0; i--) n += a[i] === undefined ? 100 : a[i]!; return n; }
function inserted(a: number[], place: number, value: number): any { for (let i = a.length; i > place; i--) a[i] = a[i - 1]!; a[place] = value; return a; }
function filled(a: number[], n: number): any { for (let i = a.length + n; i >= a.length; i--) a[i] = i; return a; }
for (let turn = 0; turn < 3; turn++) {
  for (const list of [[5, 3, 9, 1, 7], [0.5, 2, 1], [], [1], [2 ** 40, -0, NaN, 4]]) {
    console.log(shifted(list.slice()), shiftedByOne(list.slice()), asked(list.slice()), read(list), doubled(list.slice()), views(Uint8Array.from(list)), readViews(Float64Array.from(list)), inserted(list.slice(), 1, 8), filled(list.slice(), 2));
  }
}
export {};
