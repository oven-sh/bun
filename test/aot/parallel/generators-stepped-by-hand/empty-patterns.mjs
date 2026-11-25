// An empty pattern steps no generator, but the call has bound the generator's parameters.
let state = 0;
function* ofPair([a, b]) { state += 100; yield a; yield b; }
function* ofDefault(a = (state += 2)) { state += 100; yield a; }
function* plain(a) { state += 100; yield a; }
function* ofObject({ v }) { state += 100; yield v; }
const values = JSON.parse('[[1,2],7,"ab",null,{"v":3},true]');
const got = [];
function pairs(x) { let n = 0; for (let k = 0; k < 3; k++) { let [] = ofPair(x); n++; } return n; }
function objects(x) { let n = 0; for (let k = 0; k < 3; k++) { const [] = ofObject(x); n++; } return n; }
function defaults() { for (let k = 0; k < 4; k++) { const [] = ofDefault(); } return state; }
function none(x) { for (let k = 0; k < 4; k++) { const [] = plain(x); } return state; }
for (const x of values) {
    for (const f of [pairs, objects]) {
        try { got.push(f(x)); } catch (error) { got.push(error.name); }
    }
}
got.push(defaults(), none(1), state);
console.log(got.join());
