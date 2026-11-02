// A number sits in a list whose type lists string literals. The strings beside it are narrowed by a test, held as the numbers of their literals, and converted back to cells.
// Flags: --aot-validate
let out = "";
function note(value: any): void { out += String(value) + ";"; }
type Word = "10" | "A" | "long enough";
const table: Record<Word, number> = { "10": 1, "A": 2, "long enough": 3 };
function ask(list: Word[]): void {
  for (let k = -1; k <= list.length; k++) {
    const byAt = list.at(k), byIndex = list[k < 0 ? list.length + k : k];
    note(byAt === byIndex);
    note((byAt as any) < "A");
    note(table[byAt!]);
    note(`<${byAt}>`);
    note(list.includes(byIndex as any));
  }
}
ask(["A", 1, "10", "long enough"] as any);
console.log(out);
