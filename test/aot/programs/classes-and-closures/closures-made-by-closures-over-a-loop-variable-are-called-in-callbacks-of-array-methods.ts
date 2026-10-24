// Each turn of `for (let i ..)` pushes a function that makes a function that reads `i`. Callbacks of map, filter, slice, reduce, join and forEach, alone and one behind the other, call both at once.
type Read = () => number;
function makersOf(n: number): (() => Read)[] {
  const makers: (() => Read)[] = [];
  for (let i = 0; i < n; i++) makers.push(() => () => i);
  return makers;
}
function lone() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => make()()); }
function mapMap() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => make()).map(read => read()); }
function mapMapNumbers() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => make()()).map(x => x + 1); }
function filterMap() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.filter(make => make()() >= 0).map(make => make()()); }
function sliceMap() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.slice(0).map(make => make()()); }
function mapReduce() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => make()()).reduce((t, x) => t * 10 + x, 7); }
function mapJoin() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); return makers.map(make => make()()).join("+"); }
function mapForEach() { const makers: (() => Read)[] = []; for (let i = 0; i < 3; i++) makers.push(() => () => i); const seen: number[] = []; makers.map(make => make()()).forEach(x => { seen.push(x); }); return seen; }
function handedIn(makers: (() => Read)[]) { return makers.map(make => make()()).map(x => x * 2); }
function once() { return [String(lone()), String(mapMap()), String(mapMapNumbers()), String(filterMap()), String(sliceMap()), String(mapReduce()), mapJoin(), String(mapForEach()), String(handedIn(makersOf(4)))].join(" | "); }
console.log(once());
let last = "";
for (let turn = 0; turn < 200; turn++) last = once();
console.log(last);
