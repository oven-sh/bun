// An element is held by a name in the turn and used more than once: by one product twice, by two operators, by an operator and then by something that is no operator.
// The lists come out of texts at run time; they hold fractions, whole numbers, holes, texts, objects that change the list while they are asked, views and things that are no lists.
const make = text => JSON.parse(text);
function squares(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; sum = sum + v * v; } return sum; }
function twoOperators(list) { let sum = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; sum += v * 2 - v / 4; } return sum; }
function thenKept(list, kept) { let sum = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; sum += v * 3; kept.push(v); } return sum; }
function keptFirst(list, kept) { let sum = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; kept.push(v); sum += v * 3; } return sum; }
function compared(list) { let count = 0; for (let i = 0; i < list.length; i++) { const v = list[i]; if (v * v > 10) count++; } return count; }
const shrinking = make("[1,2,3,4]"); shrinking[1] = { valueOf() { shrinking.length = 2; return 5; } };
const holed = make("[1.5,2.5,3.5]"); delete holed[1];
const lists = [make("[0.5,1.5,2.5,3.5]"), make("[1,2,3,4]"), make("[1,2.5,3]"), make("[]"), make('["2","x",3]'), make("[null,true,false]"), holed, shrinking, new Float64Array([1.5, 2.5]), new Uint8Array([200, 100]), new Int32Array([-7, 7]), make('{"length":2,"0":3,"1":4}'), "123", make("[1e308,1e308]"), make("[-0,0]"), [1n, 2n]];
for (let round = 0; round < 3; round++) {
  for (const list of lists) {
    const line = [];
    for (const run of [squares, twoOperators, compared, l => { const k = []; return thenKept(l, k) + "/" + k.length; }, l => { const k = []; return keptFirst(l, k) + "/" + k.length; }]) {
      try { const said = run(list); line.push(Object.is(said, -0) ? "-0" : String(said)); } catch (error) { line.push(error.constructor.name); }
    }
    console.log(round, line.join(" | "));
  }
}
