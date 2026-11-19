class Mark { constructor(row) { this.left = row.left; this.top = row.top; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } }
Object.defineProperty(Number.prototype, "left", { get() { return this + 1; }, configurable: true });
String.prototype.top = "T";
const rows = [{ left: 1.5, top: 2, reach: 3 }, undefined, null, 7, "text", true, Symbol.iterator, 10n, { left: 4, top: 5, reach: 6 }];
const said = [];
for (let turn = 0; turn < 4; turn++) {
  for (const row of rows) {
    try { const made = new Round(row); said.push(String(made.left) + String(made.top) + String(made.reach) + Object.keys(made).length); }
    catch (error) { said.push(error.constructor.name); }
  }
}
console.log(said.join(" "));
