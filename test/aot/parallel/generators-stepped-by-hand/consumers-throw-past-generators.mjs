// What throws in the consumer of a generator that is stepped by hand runs no handler of the generator.
let closed = 0;
let caught = 0;
function answer(run) { let text; try { text = String(run()); } catch (error) { text = error.constructor === Error ? error.message : error.constructor.name; } console.log(text, closed, caught); }
function* throwsAt(n, at) { for (let i = 0; i < n; i++) { if (i === at) throw new Error("second"); if (i > at) yield i; } }
const full = [{ size: 1 }, { size: 2 }, { size: 3 }, { size: 4 }, { size: 5 }, { size: 6 }, { size: 7 }, { size: 8 }];
const short = [{ size: 1 }, undefined, { size: 3 }];
const member = { run: (k) => { if (k > 2) throw new Error("member"); return 1; } };
const none = { run: undefined };
function* makeCloses(n) { try { for (let i = 0; i < n; i++) yield [i]; } finally { closed += 100; } }
function firstIsOpenedCloses(n) { const p = makeCloses(n), w = throwsAt(n, 3); let k = 0; for (;;) { const x = p.next(), y = w.next(); if (x.done || y.done) break; k++; } return k; }
function secondIsOpenedCloses(n) { const w = throwsAt(n, 0); const p = makeCloses(n); let k = 0; for (;;) { const x = p.next(), y = w.next(); if (x.done || y.done) break; k++; } return k; }
function readsOfNothingCloses(n, list) { const p = makeCloses(n); let k = 0; for (;;) { const x = p.next(); k += list[k].size; if (x.done) break; } return k; }
function callsMemberCloses(n, member) { const p = makeCloses(n); let k = 0; for (;;) { const x = p.next(); k += member.run(k); if (x.done) break; } return k; }
function whileLoopCloses(n, list) { const p = makeCloses(n); let x, k = 0; while (!(x = p.next()).done) k += list[x.value[0]].size; return k; }
function forLoopCloses(n, list) { const p = makeCloses(n); let k = 0; for (let x = p.next(); !x.done; x = p.next()) k += list[x.value[0]].size; return k; }
function inRowCloses(n, list) { const p = makeCloses(n); const a = p.next(); const s = list[a.value[0]].size; const b = p.next(); return s + list[b.value[0]].size; }
function rowOfTwoCloses(n, member) { const p = makeCloses(n); const a = p.next(); const s = member.run(a.value[0]); const b = p.next(); member.run(5); const c = p.next(); return s + b.value + c.value; }
function inTryCloses(n, list) { const p = makeCloses(n); let k = 0; try { for (;;) { const x = p.next(); k += list[k].size; if (x.done) break; } } catch (error) { return "in consumer: " + error.constructor.name; } return k; }
function ofLoopCloses(n, list) { let k = 0; for (const [i] of makeCloses(n)) k += list[i].size; return k; }
function patternCloses(n, list) { const [[a], [b]] = makeCloses(n); return list[a].size + list[b].size; }
function calleeCloses(n, list) { const step = (x) => list[x.value[0]].size; const p = makeCloses(n); let k = 0, x; while (!(x = p.next()).done) k += step(x); return k; }
for (const n of [0, 1, 2, 3, 6]) {
  answer(() => firstIsOpenedCloses(n));
  answer(() => secondIsOpenedCloses(n));
  for (const list of [full, short]) {
    answer(() => readsOfNothingCloses(n, list));
    answer(() => whileLoopCloses(n, list));
    answer(() => forLoopCloses(n, list));
    answer(() => inRowCloses(n, list));
    answer(() => inTryCloses(n, list));
    answer(() => ofLoopCloses(n, list));
    answer(() => patternCloses(n, list));
    answer(() => calleeCloses(n, list));
  }
  for (const called of [member, none]) {
    answer(() => callsMemberCloses(n, called));
    answer(() => rowOfTwoCloses(n, called));
  }
}
function* makeCatches(n) { try { for (let i = 0; i < n; i++) yield [i]; } catch (error) { caught += 1; yield [0]; } }
function firstIsOpenedCatches(n) { const p = makeCatches(n), w = throwsAt(n, 3); let k = 0; for (;;) { const x = p.next(), y = w.next(); if (x.done || y.done) break; k++; } return k; }
function secondIsOpenedCatches(n) { const w = throwsAt(n, 0); const p = makeCatches(n); let k = 0; for (;;) { const x = p.next(), y = w.next(); if (x.done || y.done) break; k++; } return k; }
function readsOfNothingCatches(n, list) { const p = makeCatches(n); let k = 0; for (;;) { const x = p.next(); k += list[k].size; if (x.done) break; } return k; }
function callsMemberCatches(n, member) { const p = makeCatches(n); let k = 0; for (;;) { const x = p.next(); k += member.run(k); if (x.done) break; } return k; }
function whileLoopCatches(n, list) { const p = makeCatches(n); let x, k = 0; while (!(x = p.next()).done) k += list[x.value[0]].size; return k; }
function forLoopCatches(n, list) { const p = makeCatches(n); let k = 0; for (let x = p.next(); !x.done; x = p.next()) k += list[x.value[0]].size; return k; }
function inRowCatches(n, list) { const p = makeCatches(n); const a = p.next(); const s = list[a.value[0]].size; const b = p.next(); return s + list[b.value[0]].size; }
function rowOfTwoCatches(n, member) { const p = makeCatches(n); const a = p.next(); const s = member.run(a.value[0]); const b = p.next(); member.run(5); const c = p.next(); return s + b.value + c.value; }
function inTryCatches(n, list) { const p = makeCatches(n); let k = 0; try { for (;;) { const x = p.next(); k += list[k].size; if (x.done) break; } } catch (error) { return "in consumer: " + error.constructor.name; } return k; }
function ofLoopCatches(n, list) { let k = 0; for (const [i] of makeCatches(n)) k += list[i].size; return k; }
function patternCatches(n, list) { const [[a], [b]] = makeCatches(n); return list[a].size + list[b].size; }
function calleeCatches(n, list) { const step = (x) => list[x.value[0]].size; const p = makeCatches(n); let k = 0, x; while (!(x = p.next()).done) k += step(x); return k; }
for (const n of [0, 1, 2, 3, 6]) {
  answer(() => firstIsOpenedCatches(n));
  answer(() => secondIsOpenedCatches(n));
  for (const list of [full, short]) {
    answer(() => readsOfNothingCatches(n, list));
    answer(() => whileLoopCatches(n, list));
    answer(() => forLoopCatches(n, list));
    answer(() => inRowCatches(n, list));
    answer(() => inTryCatches(n, list));
    answer(() => ofLoopCatches(n, list));
    answer(() => patternCatches(n, list));
    answer(() => calleeCatches(n, list));
  }
  for (const called of [member, none]) {
    answer(() => callsMemberCatches(n, called));
    answer(() => rowOfTwoCatches(n, called));
  }
}
function* makeCatchesInTurn(n) { for (let i = 0; i < n; i++) { try { yield [i]; } catch { caught += 10; } } }
function firstIsOpenedCatchesInTurn(n) { const p = makeCatchesInTurn(n), w = throwsAt(n, 3); let k = 0; for (;;) { const x = p.next(), y = w.next(); if (x.done || y.done) break; k++; } return k; }
function secondIsOpenedCatchesInTurn(n) { const w = throwsAt(n, 0); const p = makeCatchesInTurn(n); let k = 0; for (;;) { const x = p.next(), y = w.next(); if (x.done || y.done) break; k++; } return k; }
function readsOfNothingCatchesInTurn(n, list) { const p = makeCatchesInTurn(n); let k = 0; for (;;) { const x = p.next(); k += list[k].size; if (x.done) break; } return k; }
function callsMemberCatchesInTurn(n, member) { const p = makeCatchesInTurn(n); let k = 0; for (;;) { const x = p.next(); k += member.run(k); if (x.done) break; } return k; }
function whileLoopCatchesInTurn(n, list) { const p = makeCatchesInTurn(n); let x, k = 0; while (!(x = p.next()).done) k += list[x.value[0]].size; return k; }
function forLoopCatchesInTurn(n, list) { const p = makeCatchesInTurn(n); let k = 0; for (let x = p.next(); !x.done; x = p.next()) k += list[x.value[0]].size; return k; }
function inRowCatchesInTurn(n, list) { const p = makeCatchesInTurn(n); const a = p.next(); const s = list[a.value[0]].size; const b = p.next(); return s + list[b.value[0]].size; }
function rowOfTwoCatchesInTurn(n, member) { const p = makeCatchesInTurn(n); const a = p.next(); const s = member.run(a.value[0]); const b = p.next(); member.run(5); const c = p.next(); return s + b.value + c.value; }
function inTryCatchesInTurn(n, list) { const p = makeCatchesInTurn(n); let k = 0; try { for (;;) { const x = p.next(); k += list[k].size; if (x.done) break; } } catch (error) { return "in consumer: " + error.constructor.name; } return k; }
function ofLoopCatchesInTurn(n, list) { let k = 0; for (const [i] of makeCatchesInTurn(n)) k += list[i].size; return k; }
function patternCatchesInTurn(n, list) { const [[a], [b]] = makeCatchesInTurn(n); return list[a].size + list[b].size; }
function calleeCatchesInTurn(n, list) { const step = (x) => list[x.value[0]].size; const p = makeCatchesInTurn(n); let k = 0, x; while (!(x = p.next()).done) k += step(x); return k; }
for (const n of [0, 1, 2, 3, 6]) {
  answer(() => firstIsOpenedCatchesInTurn(n));
  answer(() => secondIsOpenedCatchesInTurn(n));
  for (const list of [full, short]) {
    answer(() => readsOfNothingCatchesInTurn(n, list));
    answer(() => whileLoopCatchesInTurn(n, list));
    answer(() => forLoopCatchesInTurn(n, list));
    answer(() => inRowCatchesInTurn(n, list));
    answer(() => inTryCatchesInTurn(n, list));
    answer(() => ofLoopCatchesInTurn(n, list));
    answer(() => patternCatchesInTurn(n, list));
    answer(() => calleeCatchesInTurn(n, list));
  }
  for (const called of [member, none]) {
    answer(() => callsMemberCatchesInTurn(n, called));
    answer(() => rowOfTwoCatchesInTurn(n, called));
  }
}
function* makeAwkward(n) { try { yield [0]; try { yield [1]; yield [2]; } finally { closed += 10; } yield [3]; } finally { closed += 1000; } }
function firstIsOpenedAwkward(n) { const p = makeAwkward(n), w = throwsAt(n, 3); let k = 0; for (;;) { const x = p.next(), y = w.next(); if (x.done || y.done) break; k++; } return k; }
function secondIsOpenedAwkward(n) { const w = throwsAt(n, 0); const p = makeAwkward(n); let k = 0; for (;;) { const x = p.next(), y = w.next(); if (x.done || y.done) break; k++; } return k; }
function readsOfNothingAwkward(n, list) { const p = makeAwkward(n); let k = 0; for (;;) { const x = p.next(); k += list[k].size; if (x.done) break; } return k; }
function callsMemberAwkward(n, member) { const p = makeAwkward(n); let k = 0; for (;;) { const x = p.next(); k += member.run(k); if (x.done) break; } return k; }
function whileLoopAwkward(n, list) { const p = makeAwkward(n); let x, k = 0; while (!(x = p.next()).done) k += list[x.value[0]].size; return k; }
function forLoopAwkward(n, list) { const p = makeAwkward(n); let k = 0; for (let x = p.next(); !x.done; x = p.next()) k += list[x.value[0]].size; return k; }
function inRowAwkward(n, list) { const p = makeAwkward(n); const a = p.next(); const s = list[a.value[0]].size; const b = p.next(); return s + list[b.value[0]].size; }
function rowOfTwoAwkward(n, member) { const p = makeAwkward(n); const a = p.next(); const s = member.run(a.value[0]); const b = p.next(); member.run(5); const c = p.next(); return s + b.value + c.value; }
function inTryAwkward(n, list) { const p = makeAwkward(n); let k = 0; try { for (;;) { const x = p.next(); k += list[k].size; if (x.done) break; } } catch (error) { return "in consumer: " + error.constructor.name; } return k; }
function ofLoopAwkward(n, list) { let k = 0; for (const [i] of makeAwkward(n)) k += list[i].size; return k; }
function patternAwkward(n, list) { const [[a], [b]] = makeAwkward(n); return list[a].size + list[b].size; }
function calleeAwkward(n, list) { const step = (x) => list[x.value[0]].size; const p = makeAwkward(n); let k = 0, x; while (!(x = p.next()).done) k += step(x); return k; }
for (const n of [0, 1, 2, 3, 6]) {
  answer(() => firstIsOpenedAwkward(n));
  answer(() => secondIsOpenedAwkward(n));
  for (const list of [full, short]) {
    answer(() => readsOfNothingAwkward(n, list));
    answer(() => whileLoopAwkward(n, list));
    answer(() => forLoopAwkward(n, list));
    answer(() => inRowAwkward(n, list));
    answer(() => inTryAwkward(n, list));
    answer(() => ofLoopAwkward(n, list));
    answer(() => patternAwkward(n, list));
    answer(() => calleeAwkward(n, list));
  }
  for (const called of [member, none]) {
    answer(() => callsMemberAwkward(n, called));
    answer(() => rowOfTwoAwkward(n, called));
  }
}
