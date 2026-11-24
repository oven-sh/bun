class Mark { constructor(row) { this.left = row.left; this.top = row.top; } }
class Round extends Mark { constructor(row) { super(row); this.reach = row.reach; } }
const seen = [];
const row = new Proxy({ left: 1.5, top: 2, reach: 3 }, { get(target, key) { seen.push("row." + String(key)); return target[key]; } });
const home = { from: "stranger" };
const stranger = new Proxy(function () {}, { get(target, key) { seen.push("target." + String(key)); return key === "prototype" ? home : target[key]; } });
const said = [];
for (let turn = 0; turn < 8; turn++) {
  const made = turn % 2 ? Reflect.construct(Round, [row], stranger) : new Round(row);
  said.push(seen.splice(0).join(",") + "=" + made.from + (made instanceof Round) + Object.keys(made).join(""));
}
console.log(said.join(" | "));
