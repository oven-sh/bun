interface Crate { id: number; label: string; weight: number; stock: number }
const crates: Crate[] = [];
const at = Number(process.argv[2] ?? 12);
let calls = 0;
const odd: any = { valueOf() { calls++; crates.push({ id: 900 + calls, label: "late", weight: 1, stock: 0 }); return 0; } };
for (let id = 1; id <= 40; id++) crates.push({ id, label: `Crate ${id}`, weight: 3 + id * 5, stock: id === at ? (odd as number) : id % 7 });
(globalThis as any).keep?.(crates);
function listed() {
  return crates.map((crate) => ({ id: crate.id, label: crate.label, weight: crate.weight, inStock: crate.stock > 0 }));
}
const table = { listed };
let sum = 0;
for (let round = 0; round < 3; round++) {
  const made = table[process.argv.length > 99 ? ("other" as "listed") : "listed"]();
  sum += made.length;
  console.log(round, made.length, crates.length, calls, JSON.stringify(made.slice(Math.max(0, at - 3), at + 2)));
}
console.log(sum);
