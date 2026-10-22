// A read, a call of a built-in that writes what was read by another way than a store, and the same read again, all in one function, in a loop.
function defineByte(u) { const before = u[0]; Object.defineProperty(u, "0", { value: before + 1 }); return before * 100 + u[0]; }
function reflectDefineByte(u) { const before = u[0]; Reflect.defineProperty(u, "0", { value: before + 1 }); return before * 100 + u[0]; }
function assignByte(u) { const before = u[0]; Object.assign(u, { 0: before + 1 }); return before * 100 + u[0]; }
function assignFromList(u) { const before = u[1]; Object.assign(u, [0, before + 1]); return before * 100 + u[1]; }
function reflectSetByte(u) { const before = u[0]; Reflect.set(u, 0, before + 1); return before * 100 + u[0]; }
function reflectSetByReceiver(u, o) { const before = u[0]; Reflect.set(o, "0", before + 1, u); return before * 100 + u[0]; }
function definesByte(u) { const before = u[0]; Object.defineProperties(u, { 0: { value: before + 1 } }); return before * 100 + u[0]; }
function defineLastIndex(re) { const before = re.lastIndex; Object.defineProperty(re, "lastIndex", { value: before + 1 }); return before * 100 + re.lastIndex; }
function reflectLastIndex(re) { const before = re.lastIndex; Reflect.set(re, "lastIndex", before + 1); return before * 100 + re.lastIndex; }
function assignLastIndex(re) { const before = re.lastIndex; Object.assign(re, { lastIndex: before + 1 }); return before * 100 + re.lastIndex; }
function defineLength(a) { const before = a.length; Object.defineProperty(a, "length", { value: before - 1 }); return before * 100 + a.length; }
function reflectLength(a) { const before = a.length; Reflect.set(a, "length", before - 1); return before * 100 + a.length; }
function assignLength(a) { const before = a.length; Object.assign(a, { length: before - 1 }); return before * 100 + a.length; }
function defineElement(a) { const before = a[0]; Object.defineProperty(a, "0", { value: before + 1 }); return before * 100 + a[0]; }
function freezeThenStore(a) { const before = a[0]; Object.freeze(a); try { a[0] = before + 1; } catch {} return before * 100 + a[0]; }
function freezeLastIndex(re) { Object.freeze(re); let threw = 0; try { re.lastIndex = 5; } catch { threw = 1; } return re.lastIndex * 10 + threw; }
function pushOnBytes(u) { const before = u.length; let threw = 0; try { Array.prototype.push.call(u, 9); } catch { threw = 1; } return before * 10 + threw; }
function pushPastEnd() { const a = []; a.length = 4294967295; let name = ""; try { a.push(1); } catch (e) { name = e.name; } return name + " " + a.length + " " + a[4294967295]; }
function fillByCall(u) { const before = u[0]; Array.prototype.fill.call(u, before + 1); return before * 100 + u[0]; }
function reverseByCall(u) { const before = u[0]; Array.prototype.reverse.call(u); return before * 100 + u[0]; }
function copyWithinByCall(u) { const before = u[0]; Array.prototype.copyWithin.call(u, 0, 1); return before * 100 + u[0]; }
function sortByCall(u) { const before = u[0]; Array.prototype.sort.call(u); return before * 100 + u[0]; }
function setDate(d) { const before = d.getTime(); Date.prototype.setTime.call(d, before + 1); return d.getTime() - before; }
const cases = {
  defineByte: () => defineByte(new Uint8Array([3, 4])), reflectDefineByte: () => reflectDefineByte(new Uint8Array([3, 4])), assignByte: () => assignByte(new Uint8Array([3, 4])),
  assignFromList: () => assignFromList(new Uint8Array([3, 4])), reflectSetByte: () => reflectSetByte(new Uint8Array([3, 4])), reflectSetByReceiver: () => reflectSetByReceiver(new Uint8Array([3, 4]), {}),
  definesByte: () => definesByte(new Uint8Array([3, 4])), defineLastIndex: () => defineLastIndex(/a/g), reflectLastIndex: () => reflectLastIndex(/a/g), assignLastIndex: () => assignLastIndex(/a/g),
  defineLength: () => defineLength([1, 2, 3]), reflectLength: () => reflectLength([1, 2, 3]), assignLength: () => assignLength([1, 2, 3]), defineElement: () => defineElement([1, 2, 3]),
  freezeThenStore: () => freezeThenStore([1, 2, 3]), freezeLastIndex: () => freezeLastIndex(/a/g), pushOnBytes: () => pushOnBytes(new Uint8Array(2)), pushPastEnd,
  fillByCall: () => fillByCall(new Uint8Array([3, 4])), reverseByCall: () => reverseByCall(new Uint8Array([3, 4])), copyWithinByCall: () => copyWithinByCall(new Uint8Array([3, 4])),
  sortByCall: () => sortByCall(new Uint8Array([9, 4])), setDate: () => setDate(new Date(5)),
};
for (const name in cases) { let last; for (let i = 0; i < (name === "pushPastEnd" ? 3 : 400); i++) last = cases[name](); console.log(name, last); }
