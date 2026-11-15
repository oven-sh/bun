// An iterator that was stepped, is spent, is spread twice, is read behind the spread, or whose table changed between its making and the spread.
function show(list: any[]): string { return list.length + ":" + list.join(","); }
const lines: string[] = [];
for (let turn = 0; turn < 3; turn++) {
  const m = new Map<any, any>([[1, "a"], [2, "b"], [3, "c"], [4, "d"]]);
  const s = new Set<any>([1, 2, 3, 4]);
  const stepped = m.values(); stepped.next();
  const steppedKeys = m.keys(); steppedKeys.next(); steppedKeys.next();
  const steppedOfSet = s.values(); steppedOfSet.next();
  const spent = m.values(); for (const _ of spent) { }
  const twice = m.values();
  const twiceOfSet = s.keys();
  const early = m.values(); const earlyOfSet = s.values();
  m.delete(2); m.set(5, "e"); s.delete(2); s.add(5);
  const behind = m.keys();
  const list = [...behind];
  const own: any = m.values(); own.next = function () { return { done: true, value: undefined }; };
  const named: any = m.values(); named.extra = 1;
  lines.push([turn, show([...stepped]), show([...steppedKeys]), show([...steppedOfSet]), show([...spent]), show([...twice]), show([...twice]), show([...twiceOfSet]), show([...twiceOfSet]), show([...early]), show([...earlyOfSet]), show(list), JSON.stringify(behind.next()), show([...own]), show([...named]), JSON.stringify(named.next())].join(" | "));
  m.set(6, "f");
  lines.push([turn, JSON.stringify(behind.next()), JSON.stringify(twice.next()), show([...m.values()])].join(" | "));
}
for (let turn = 0; turn < 3; turn++) {
  const m = new Map<any, any>([[1, "a"], [2, "b"]]);
  const s = new Set<any>([1, 2]);
  const ownNext: any = m.values(); ownNext.next = function () { return { done: true, value: undefined }; };
  const ownOpen: any = m.keys(); ownOpen[Symbol.iterator] = function () { return [7, 8][Symbol.iterator](); };
  const ownReturn: any = m.values(); ownReturn.return = function () { lines.push("returned"); return {}; };
  const ownNextOfSet: any = s.values(); ownNextOfSet.next = function () { return { done: true, value: undefined }; };
  const ownOpenOfSet: any = s.keys(); ownOpenOfSet[Symbol.iterator] = function () { return [7, 8][Symbol.iterator](); };
  lines.push([turn, show(["t", ...ownNext]), show([0, ...ownOpen]), show(["t", ...ownReturn]), show([0, ...ownNextOfSet]), show([0, ...ownOpenOfSet])].join(" | "));
}
class Kept extends Map<any, any> { values(): any { return super.keys(); } }
class Odd extends Map<any, any> { *values(): any { yield "odd"; } }
const kept = new Kept([[1, "a"]]), odd = new Odd([[1, "a"]]);
for (let turn = 0; turn < 2; turn++) lines.push(show([...kept.values()]) + " | " + show([...odd.values()]) + " | " + show([...kept.keys()]));
console.log(lines.join("\n"));
