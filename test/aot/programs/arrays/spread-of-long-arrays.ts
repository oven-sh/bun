// Spreading an array of a hundred thousand elements or more copies it as a short one is copied.
function sum(list: readonly unknown[]): string {
  let h = 0;
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    h = (h * 31 + (typeof x === "number" ? Math.round(x * 4) : typeof x === "string" ? x.length + 1 : x === undefined ? 7 : x === null ? 11 : (x as { id: number }).id)) % 1000003;
  }
  return list.length + ":" + h;
}
function integers(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i); return a; }
function fractions(n: number): number[] { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i + 0.25); return a; }
function objects(n: number): { id: number }[] { const a: { id: number }[] = []; for (let i = 0; i < n; i++) a.push({ id: i % 977 }); return a; }
function strings(n: number): string[] { const a: string[] = []; for (let i = 0; i < n; i++) a.push("s" + (i % 100)); return a; }
function mixed(n: number): (number | string | null | undefined)[] { const a: (number | string | null | undefined)[] = []; for (let i = 0; i < n; i++) a.push(i % 4 === 0 ? i : i % 4 === 1 ? "m" : i % 4 === 2 ? null : undefined); return a; }
const sizes = [99998, 99999, 100000, 100001, 150000, 262144];
let out = "";
for (const n of sizes) {
  const i = integers(n), f = fractions(n), o = objects(n), s = strings(n), m = mixed(n);
  const copies = [[...i], [...f], [...o], [...s], [...m]];
  out += n + " " + copies.map(sum).join(" ") + "\n";
  out += [sum([-1, ...i]), sum([...i, -1]), sum([0.5, ...i]), sum(["x", ...i, ...f]), sum([...f, ...i]), sum([...i, ...i]), sum([...o, ...s, null]), sum([1, 2, 3, ...f, 4])].join(" ") + "\n";
  const copy = [...i];
  copy.push(1, 2, 3);
  copy[5] = -5;
  out += sum(copy) + " " + sum(i) + " " + (copy === i) + " " + copy.indexOf(n - 1) + "\n";
}
const holey = integers(120000);
delete holey[77777];
const withHole = [...holey];
out += sum(withHole) + " " + (77777 in withHole) + " " + (77777 in holey) + "\n";
const nans = fractions(120000);
nans[5] = NaN;
const withNaN = [...nans];
out += withNaN.length + " " + Number.isNaN(withNaN[5]) + " " + withNaN[6] + "\n";
const frozen = Object.freeze(integers(110000));
out += sum([...frozen]) + " " + Object.isFrozen([...frozen]) + "\n";
class List extends Array<number> {}
const heir = new List();
for (let k = 0; k < 110000; k++) heir.push(k);
const fromHeir = [...heir];
out += sum(fromHeir) + " " + (fromHeir instanceof List) + "\n";
function count(...all: number[]): number { return all.length; }
out += [...integers(130000)].length + " " + Math.max(...integers(100)) + " " + count(...integers(1000)) + "\n";
console.log(out);
