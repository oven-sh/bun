// What a function is handed lies in an object, an array or a closure of the function's own, which it hands on. Whoever gets that reads the first object out and changes
// it. The maker of the object is two calls away from the function that stored it.
function changeBox(b) { b.o.x = 1; }
function holdInBox(o) { const box = { o }; changeBox(box); }
function viaBox(o) { holdInBox(o); }
function first() { const o = { x: 0 }; viaBox(o); return o.x; }

function changeDeep(b) { b.inner.o.x += 2; }
function holdDeep(o) { const box = { inner: { o } }; changeDeep(box); }
function viaDeep(o) { holdDeep(o); }
function second() { const o = { x: 0 }; o.x = 5; viaDeep(o); return o.x; }

function changeList(list) { list[0].x = 9; }
function holdInList(o) { changeList([o]); }
function viaList(o) { holdInList(o); }
function third() { const o = { x: 0 }; viaList(o); return o.x; }

function changePushed(list) { list[list.length - 1].x = 11; }
function holdPushed(o) { const list = []; list.push(o); changePushed(list); }
function viaPushed(o) { holdPushed(o); }
function fourth() { const o = { x: 0 }; viaPushed(o); return o.x; }

function run(f) { f(); }
function holdInClosure(o) { run(() => { o.x = 13; }); }
function viaClosure(o) { holdInClosure(o); }
function fifth() { const o = { x: 0 }; viaClosure(o); return o.x; }

function runMethod(holder) { holder.change(); }
function holdInMethod(o) { runMethod({ change() { o.x = 17; } }); }
function viaMethod(o) { holdInMethod(o); }
function sixth() { const o = { x: 0 }; viaMethod(o); return o.x; }

function changeMap(map) { map.get("o").x = 19; }
function holdInMap(o) { const map = new Map(); map.set("o", o); changeMap(map); }
function viaMap(o) { holdInMap(o); }
function seventh() { const o = { x: 0 }; viaMap(o); return o.x; }

console.log(first(), second(), third(), fourth(), fifth(), sixth(), seventh());
let sum = 0;
for (let i = 0; i < 4; i++) sum += first() + second() + third() + fourth() + fifth() + sixth() + seventh();
console.log(sum);
