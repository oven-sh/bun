// slice() takes its copy before the first callback runs. The callbacks of the methods behind it change the array that the copy was taken from, which they reach
// as a capture, through an object, through a variable that is assigned again, or as `this`. What they are handed is what the copy holds.
const changes = {
  pop: list => { list.pop(); },
  shift: list => { list.shift(); },
  cut: list => { list.length = 1; },
  empty: list => { list.length = 0; },
  splice: list => { list.splice(0, 2); },
  fill: list => { list.fill(70); },
  reverse: list => { list.reverse(); },
  sort: list => { list.sort((a, b) => b - a); },
  push: list => { list.push(90); },
  unshift: list => { list.unshift(80); },
  copyWithin: list => { list.copyWithin(0, 2); },
};

function popsInForEach() { const queue = [1, 2, 3, 4]; let sum = 0; queue.slice().forEach(item => { queue.pop(); sum += item; }); return sum; }
function shiftsInForEach() { const queue = [1, 2, 3, 4]; let sum = 0; queue.slice().forEach(item => { queue.shift(); sum = sum * 3 + item; }); return sum; }
function cutsInForEach() { const queue = [1, 2, 3, 4]; let sum = 0; queue.slice().forEach(item => { queue.length = 0; sum += item; }); return sum; }
function splicesInForEach() { const queue = [1, 2, 3, 4]; let sum = 0; queue.slice().forEach(item => { queue.splice(queue.indexOf(item), 1); sum += item; }); return sum + ":" + queue.length; }
function fillsInReduce() { const list = [1, 2, 3, 4]; return list.slice().map(x => x * 2).reduce((sum, y) => { list.fill(7); return sum + y; }, 0); }
function reversesInReduce() { const list = [1, 2, 3, 4]; return list.slice().map(x => x * 2).reduce((sum, y) => { list.reverse(); return sum * 3 + y; }, 0); }
function storesInReduce() { const list = [1, 2, 3, 4]; return list.slice().map(x => x * 2).reduce((sum, y, i) => { list[i + 1] = 100; return sum + y; }, 0); }
function storesInMap() { const list = [1, 2, 3, 4]; return list.slice().map((y, i) => { list[i + 1] = 50; return y; }).join(); }
function popsInFilter() { const list = [1, 2, 3, 4]; return list.slice(1).filter(y => { list.pop(); return y > 0; }).length; }
function popsInSome() { const list = [1, 2, 3, 4]; return list.slice().some(y => { list.pop(); return y === 4; }); }
function popsInEvery() { const list = [1, 2, 3, 4]; let calls = 0; list.slice().every(() => { list.pop(); calls++; return true; }); return calls; }
function popsInFind() { const list = [1, 2, 3, 4]; return list.slice().find(y => { list.pop(); return y === 4; }); }
function popsInFindIndex() { const list = [1, 2, 3, 4]; return list.slice(1, 4).findIndex(y => { list.pop(); return y === 4; }); }
function popsInFlatMap() { const list = [1, 2, 3, 4]; return list.slice(-3).flatMap(y => { list.pop(); return [y, y]; }).join(); }
function popsThroughObject() { const holder = { list: [1, 2, 3, 4] }; let sum = 0; holder.list.slice().forEach(item => { holder.list.pop(); sum += item; }); return sum; }
function popsThroughVariable() { let list = [0]; list = [1, 2, 3, 4]; let sum = 0; list.slice().forEach(item => { list.pop(); sum += item; }); return sum; }
function popsThroughThis() { const list = [1, 2, 3, 4]; let sum = 0; list.slice().forEach(function (item) { this.pop(); sum += item; }, list); return sum; }
function popsThroughSecondClosure() { const list = [1, 2, 3, 4]; const pop = () => list.pop(); let sum = 0; list.slice().forEach(item => { pop(); sum += item; }); return sum; }
function popsFilledList(n) { const list = []; for (let i = 1; i <= n; i++) list.push(i); let sum = 0; list.slice().forEach(item => { list.pop(); sum += item; }); return sum; }
function changesBy(change) { const list = [1, 2, 3, 4]; return list.slice().map(x => x + 1).reduce((sum, y) => { change(list); return sum * 2 + y; }, 0) + ":" + list.join(); }

const seen = new Set();
for (let turn = 0; turn < 3000; turn++) {
  seen.add([
    popsInForEach(), shiftsInForEach(), cutsInForEach(), splicesInForEach(), fillsInReduce(), reversesInReduce(), storesInReduce(), storesInMap(), popsInFilter(), popsInSome(), popsInEvery(),
    popsInFind(), popsInFindIndex(), popsInFlatMap(), popsThroughObject(), popsThroughVariable(), popsThroughThis(), popsThroughSecondClosure(), popsFilledList(4),
  ].join(" "));
  for (const name in changes)
    seen.add(name + " " + changesBy(changes[name]));
}
console.log([...seen].join("\n"));
