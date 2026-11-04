// The traversal asks the list once, in front of the first element. What a callback does to the list from then on, each turn has to see.
const report = x => console.log(x);
function grows(list) { return list.map(x => { if (list.length < 6) list.push(x + 10); return x; }); }
function shrinks(list) { return list.map(x => { list.pop(); return x; }); }
function empties(list) { const seen = []; list.forEach(x => { seen.push(x); list.length = 0; }); return seen; }
function deletes(list) { return list.filter((x, i) => { delete list[i + 1]; return true; }); }
function replaces(list) { return list.map((x, i) => { list[i + 1] = "r" + i; return x; }); }
function becomesDoubles(list) { return list.map((x, i) => { list[i + 1] = 0.5; return x; }); }
function getsGetter(list) { return list.map((x, i) => { if (!i) Object.defineProperty(list, 2, { get() { return "got"; }, configurable: true }); return x; }); }
function moves(list) { return list.map((x, i) => { if (!i) { delete list[1]; Object.setPrototypeOf(list, { __proto__: Array.prototype, 1: "above" }); } return x; }); }
function throwsAt(list) { try { return list.map(x => { if (x === 2) throw new RangeError("two"); return x; }); } catch (error) { return error.message; } }
function takesThis(list) { return list.map(function (x) { return x + this.add; }, { add: 5 }); }
function takesAll(list) { return list.map((x, i, whole) => x + i + whole.length); }
function reducesNothing(list) { try { return list.reduce((a, x) => a + x); } catch (error) { return error instanceof TypeError; } }
function findsInHoles(list) { let visits = 0; const found = list.find(x => { visits++; return false; }); return [found, visits]; }
function somesHoles(list) { let visits = 0; list.some(x => { visits++; return false; }); return visits; }
function storesIntoResult(list) { const made = list.map(x => x); made.push(9); return [made, list]; }
function flat(list) { return list.flatMap((x, i) => i & 1 ? x : [x, [x], , 4]); }
function stops(list) { const seen = []; const answer = list.some(x => { seen.push(x); return x === 2; }); return [answer, seen]; }
for (let turn = 0; turn < 2; turn++) {
  report(JSON.stringify(grows([1, 2, 3])));
  report(JSON.stringify(shrinks([1, 2, 3, 4])));
  report(JSON.stringify(empties([1, 2, 3])));
  report(JSON.stringify(deletes([1, 2, 3, 4])));
  report(JSON.stringify(replaces([1, 2, 3])));
  report(JSON.stringify(becomesDoubles([1, 2, 3])));
  report(JSON.stringify(getsGetter([1, 2, 3])));
  report(JSON.stringify(moves([1, 2, 3])));
  report(JSON.stringify(throwsAt([1, 2, 3])));
  report(JSON.stringify(takesThis([1, 2, 3])));
  report(JSON.stringify(takesAll([1, 2, 3])));
  report(JSON.stringify(reducesNothing([])));
  report(JSON.stringify(reducesNothing([, ,])));
  report(JSON.stringify(reducesNothing([4])));
  report(JSON.stringify(findsInHoles([1, , 3])));
  report(JSON.stringify(somesHoles([1, , 3])));
  report(JSON.stringify(storesIntoResult([1, 2])));
  report(JSON.stringify(flat([1, 2, 3])));
  report(JSON.stringify(stops([1, 2, 3])));
}
