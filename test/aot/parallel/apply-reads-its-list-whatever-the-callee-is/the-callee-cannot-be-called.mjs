// `f.apply(t, list)` with an f that cannot be called: the list is read (its length, its getters), and the TypeError comes afterwards: inside a function and in tail position, for what is like a list and for an array. The last number of a row: how often the list was read in 300 calls.
let reads = 0;
const fake = Object.create(Function.prototype);
function real() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return arguments.length + work; }
function like() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return { weight: work, get length() { reads++; return 0; } }; }
function list() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const made = [work, 2, 3]; Object.defineProperty(made, 1, { get() { reads++; return 2; } }); return made; }
function inside(callee, given) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; const answer = callee.apply(null, given); return answer + work; }
function tail(callee, given) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return callee.apply(null, given); }
function attempt(call, callee, make) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; try { return String(call(callee, make())); } catch (error) { return error.name; } }
function row(label, call, make) {
  let said = label;
  for (const callee of [real, fake]) {
    let last = "";
    reads = 0;
    for (let round = 0; round < 300; round++) last = attempt(call, callee, make);
    said += " " + last + " " + reads;
  }
  console.log(said);
}
row("inside like", inside, like);
row("inside list", inside, list);
row("tail like", tail, like);
row("tail list", tail, list);
/* Output:
inside like 2 300 TypeError 300
inside list 5 300 TypeError 300
tail like 1 300 TypeError 300
tail list 4 300 TypeError 300
*/
