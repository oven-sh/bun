function Top() { this.t = 1; }
function F1() {}
class O { constructor(n) { this.x = n; } }
function spoil(o) { o.x = "text"; return true; }
function sum(o) { return o.x + 1; }
function isTop(value) { return value instanceof Top; }
let said = "";
for (let turn = 0; turn < 4; turn++) {
    if (turn === 2) {
        for (const each of [Top, F1])
            Object.defineProperty(each, Symbol.hasInstance, { value: spoil });
    }
    const o = new O(JSON.parse("1"));
    said += isTop(o) + " " + sum(o) + " " + isTop(new Top()) + " ";
}
console.log(said);
