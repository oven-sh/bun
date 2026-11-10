class Tagged {}
class Other extends Tagged { constructor(n) { super(); this.x = n; } }
function sum(o) { return o.x + 1; }
function ask(o) { return o instanceof Other; }
let said = "";
for (let turn = 0; turn < 4; turn++) {
    if (turn === 2)
        Object.defineProperty(Tagged, Symbol.hasInstance, { value: (v) => { v.x = "text"; return false; } });
    const o = new Other(JSON.parse("1"));
    said += ask(o) + " " + sum(o) + " ";
}
console.log(said);
