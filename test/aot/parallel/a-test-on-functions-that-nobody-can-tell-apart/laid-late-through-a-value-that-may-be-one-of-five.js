function Top() { this.t = 1; }
function F1() {}
function F2() {}
function F3() {}
function F4() {}
class O { constructor(n) { this.x = n; } }
function spoil(o) { o.x = "text"; return true; }
function sum(o) { return o.x + 1; }
function lay(each) { Object.defineProperty(each, Symbol.hasInstance, { value: spoil }); }
function isTop(value) { return value instanceof Top; }
let said = "";
for (let turn = 0; turn < 4; turn++) {
    if (turn === 2) {
        for (const each of [Top, F1, F2, F3, F4])
            lay(each);
    }
    const o = new O(JSON.parse("1"));
    said += isTop(o) + " " + sum(o) + " " + isTop(new Top()) + " ";
}
console.log(said);
