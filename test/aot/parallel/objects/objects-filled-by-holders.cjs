// Objects get late names from who holds them: a list that is returned, a callback, a field. They take as many bytes as those that the allocating function fills itself. Where few get the names, the others stay small.
// Both are counts of the build and of its executable, the same on each chip and in each run. A heap read behind a collection is neither: plain Bun's and the executable's differ from run to run.
// The fields that lie beside their cells are those of the four classes whose names few objects get: eight each.
// STATISTIC: FieldsOutOfLine = 32
// Where every class had them there, storage would be asked for hundreds of times.
// COUNT: operation:operationAOTEnsureExtensionGranules <= 16
"use strict";
const size = 20000;
const numbers = Array.from({ length: size }, (_, i) => i);
class Here { constructor(x) { this.x = x; } }
function buildHere(n) { const list = []; for (let i = 0; i < n; i++) list.push(new Here(i)); for (let i = 0; i < list.length; i++) { const p = list[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } return list; }
class Made { constructor(x) { this.x = x; } }
function makeMade(i) { return new Made(i); }
function fillMade(list) { for (let i = 0; i < list.length; i++) { const p = list[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } }
function buildMade(n) { const list = []; for (let i = 0; i < n; i++) list.push(makeMade(i)); fillMade(list); return list; }
class Returned { constructor(x) { this.x = x; } }
function listReturned(n) { const list = []; for (let i = 0; i < n; i++) list.push(new Returned(i)); return list; }
function fillReturned(list) { for (let i = 0; i < list.length; i++) { const p = list[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } }
function buildReturned(n) { const list = listReturned(n); fillReturned(list); return list; }
class Listed { constructor(x) { this.x = x; } }
function fillListed(list) { for (let i = 0; i < list.length; i++) { const p = list[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } }
function buildListed(n) { const list = Array.from({ length: n }, (_, i) => new Listed(i)); fillListed(list); return list; }
class Mapped { constructor(x) { this.x = x; } }
function fillMapped(list) { for (let i = 0; i < list.length; i++) { const p = list[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } }
function buildMapped(n) { const list = numbers.map(i => new Mapped(i)); fillMapped(list); return list; }
class Each { constructor(x) { this.x = x; } }
function fillEach(list) { list.forEach((p, i) => { p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; }); }
function buildEach(n) { const list = []; for (let i = 0; i < n; i++) list.push(new Each(i)); fillEach(list); return list; }
class Stepped { constructor(x) { this.x = x; } }
function fillStepped(list) { let i = 0; for (const p of list) { p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; i++; } }
function buildStepped(n) { const list = []; for (let i = 0; i < n; i++) list.push(new Stepped(i)); fillStepped(list); return list; }
class Held { constructor(x) { this.x = x; } }
class Grid { constructor(n) { this.points = []; for (let i = 0; i < n; i++) this.points.push(new Held(i)); } prepare() { for (let i = 0; i < this.points.length; i++) { const p = this.points[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } } }
function buildHeld(n) { const grid = new Grid(n); grid.prepare(); return grid.points; }
class Added { constructor(x) { this.x = x; } }
class Collection { constructor() { this.members = []; } add(p) { this.members.push(p); } prepare() { for (let i = 0; i < this.members.length; i++) { const p = this.members[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } } }
function buildAdded(n) { const collection = new Collection(); for (let i = 0; i < n; i++) collection.add(new Added(i)); collection.prepare(); return collection.members; }
class Tried { constructor(x) { this.x = x; } }
function fillTried(list) { for (let i = 0; i < list.length; i++) { const p = list[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } }
function buildTried(n) { const list = []; for (let i = 0; i < n; i++) list.push(new Tried(i)); try { fillTried(list); } catch (error) { console.log(error); } return list; }
class Row { constructor(x) { this.x = x; } }
function buildRow(n) { const rows = []; for (let y = 0; y < 10; y++) { const row = []; for (let i = 0; i < n / 10; i++) row.push(new Row(i)); rows.push(row); } for (let y = 0; y < rows.length; y++) { const row = rows[y]; for (let i = 0; i < row.length; i++) { const p = row[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } } return rows.flat(); }
class Passed { constructor(x) { this.x = x; } }
function addPassed(list, i) { list.push(new Passed(i)); }
function fillPassed(list) { for (let i = 0; i < list.length; i++) { const p = list[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } }
function buildPassed(n) { const list = []; for (let i = 0; i < n; i++) addPassed(list, i); fillPassed(list); return list; }
class Other { constructor(x) { this.x = x; } }
function listOther(n) { const list = []; for (let i = 0; i < n; i++) list.push(new Other(i)); return list; }
function fillOther(list) { for (let i = 0; i < list.length; i++) { const p = list[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } }
function buildOther(n) { fillOther(listOther(3)); return listOther(n); }
class Broken { constructor(x) { this.x = x; } }
function fillBroken(list) { for (let i = 0; i < list.length; i++) { const p = list[i]; p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; if (i > 10) break; } }
function buildBroken(n) { const list = []; for (let i = 0; i < n; i++) list.push(new Broken(i)); fillBroken(list); return list; }
class Later { constructor(x) { this.x = x; } }
function fillLater(list) { list.forEach((p, i) => { p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; }); }
function buildLater(n) { const list = []; fillLater(list); for (let i = 0; i < n; i++) list.push(new Later(i)); return list; }
class Maybe { constructor(x) { this.x = x; } }
function makeMaybe(i, wide) { const p = new Maybe(i); if (wide) { p.a = i; p.b = 1.5; p.c = i; p.d = 2.5; p.e = i; p.f = 3.5; p.g = i; p.h = 4.5; } return p; }
function buildMaybe(n) { return Array.from({ length: n }, (_, i) => makeMaybe(i, i === 3)); }
let sum = 0, keys = "";
const allHere = buildHere(size);
for (let i = 0; i < size; i++) { const p = allHere[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allHere[1]).length;
const allMade = buildMade(size);
for (let i = 0; i < size; i++) { const p = allMade[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allMade[1]).length;
const allReturned = buildReturned(size);
for (let i = 0; i < size; i++) { const p = allReturned[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allReturned[1]).length;
const allListed = buildListed(size);
for (let i = 0; i < size; i++) { const p = allListed[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allListed[1]).length;
const allMapped = buildMapped(size);
for (let i = 0; i < size; i++) { const p = allMapped[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allMapped[1]).length;
const allEach = buildEach(size);
for (let i = 0; i < size; i++) { const p = allEach[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allEach[1]).length;
const allStepped = buildStepped(size);
for (let i = 0; i < size; i++) { const p = allStepped[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allStepped[1]).length;
const allHeld = buildHeld(size);
for (let i = 0; i < size; i++) { const p = allHeld[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allHeld[1]).length;
const allAdded = buildAdded(size);
for (let i = 0; i < size; i++) { const p = allAdded[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allAdded[1]).length;
const allTried = buildTried(size);
for (let i = 0; i < size; i++) { const p = allTried[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allTried[1]).length;
const allRow = buildRow(size);
for (let i = 0; i < size; i++) { const p = allRow[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allRow[1]).length;
const allPassed = buildPassed(size);
for (let i = 0; i < size; i++) { const p = allPassed[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allPassed[1]).length;
const allOther = buildOther(size);
for (let i = 0; i < size; i++) { const p = allOther[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allOther[1]).length;
const allBroken = buildBroken(size);
for (let i = 0; i < size; i++) { const p = allBroken[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allBroken[1]).length;
const allLater = buildLater(size);
for (let i = 0; i < size; i++) { const p = allLater[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allLater[1]).length;
const allMaybe = buildMaybe(size);
for (let i = 0; i < size; i++) { const p = allMaybe[i]; sum += p.x + (p.a ?? 0) + (p.d ?? 0) + (p.h ?? 0); }
keys += Object.keys(allMaybe[1]).length;
console.log(sum, keys);
console.log(allHere.length + allMade.length + allReturned.length + allListed.length + allMapped.length + allEach.length + allStepped.length + allHeld.length + allAdded.length + allTried.length + allRow.length + allPassed.length + allOther.length + allBroken.length + allLater.length + allMaybe.length);
