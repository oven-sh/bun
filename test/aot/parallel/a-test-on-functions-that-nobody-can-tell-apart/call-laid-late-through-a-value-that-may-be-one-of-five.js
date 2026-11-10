function Base(v) { this.v = v; }
function Sub(v) { Base.call(this, v); }
function G1() {}
function G2() {}
function G3() {}
function G4() {}
function laid(self, v) { self.v = "laid " + v; }
let said = "";
for (let turn = 0; turn < 4; turn++) {
    if (turn === 2) {
        for (const each of [Base, G1, G2, G3, G4])
            each.call = laid;
    }
    said += new Sub(turn).v + " ";
}
console.log(said);
