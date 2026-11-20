// A function that asks something in front of its loop and hands a number in and out, called in a loop: its question is copied, and the rest is called.
// Where the call takes the number in another form than the copy holds it, the rest is entered as from out of sight. What is printed is what plain Bun prints.
function keep(k, v, o, a) { if (a.length === 0) return k; for (let j = 0; j < 2; j++) if (v) o.f = 1; return k; }
function overList(d) { let k = 0; const o = {}, a = [1]; for (const v of d) k = keep(k, v, o, a); return [k, o]; }
function overIndexes(d) { let k = 0; const o = {}, a = [1]; for (let i = 0; i < d.length; i++) k = keep(k, d[i], o, a); return [k, o]; }
function handedIn(d, a) { let k = 0; const o = {}; for (const v of d) k = keep(k, v, o, a); return [k, o]; }
globalThis.overList = overList;
globalThis.overIndexes = overIndexes;
globalThis.handedIn = handedIn;
console.log(JSON.stringify(globalThis.overList([true, false, true])), JSON.stringify(globalThis.overList([0, false])));
console.log(JSON.stringify(globalThis.overIndexes([true, false, true])), JSON.stringify(globalThis.overIndexes([])));
console.log(JSON.stringify(globalThis.handedIn([1, 2], [5])), JSON.stringify(globalThis.handedIn([1, 2], [])));
