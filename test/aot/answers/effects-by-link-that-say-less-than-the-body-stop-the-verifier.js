// answers: without-library
// # function bump(box, depth) { if (depth) bump(box, depth - 1); else box.count = box.count + 1; }
// # Link's effects of f2 are taken to name no write of ObjectFields, as the verifier of a unit reads them: the PutSlot of the body stops it. No run is needed.
// # OPTIONS: check=Validate testing=UnderstateEffects:Summary/f2/ObjectFields
// # DIAGNOSTIC: EffectsNotCounted
// # RUN: walk f2 mechanisms=all
// # CHECK-NOT: code f2:Body
// # f2 = bump
const bare = JSON.parse('{"size":1}');
const watched = Object.defineProperty(JSON.parse("{}"), "size", { get() { return 2; } });
function read(box) { return box.size; }
const list = JSON.parse("[1,2,3]");
function put(target, at, value) { target[at] = value; return target.length; }
function flip(values) { const first = values[0]; values.reverse(); return first * 10 + values[0]; }
function double(key, value) { return typeof value === "number" ? value * 2 : value; }
function revive(text, reviver) { return JSON.parse(text, reviver); }
function parse(text, depth) { return depth ? parse(text, depth - 1) : JSON.parse(text); }
class Box { constructor() { this.count = 1; } }
function bump(box, depth) { if (depth) bump(box, depth - 1); else box.count = box.count + 1; }
function count(box) { const before = box.count; bump(box, 2); return before * 100 + box.count; }
let sum = 0;
for (let turn = 0; turn < 4; turn++) sum += read(turn & 1 ? watched : bare);
report(sum);
for (let turn = 0; turn < 4; turn++) sum += put(list, list.length, turn);
report(sum);
const three = [1, 2, 3];
for (let turn = 0; turn < 3; turn++) sum += flip(three);
report(sum);
report(revive("[1,2,3]", double).join());
report(parse('{"size":[1,2,3]}', 3).size.length);
const texts = ["1", "{"];
for (let turn = 0; turn < 2; turn++) {
  try { sum += parse(texts[turn], 3); } catch (error) { sum += 100; }
}
report(sum);
const box = new Box();
for (let turn = 0; turn < 2; turn++) sum += count(box);
report(sum);
report("end");
