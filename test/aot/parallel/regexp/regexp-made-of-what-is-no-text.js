// a RegExp is made of a number, of null, undefined, true, of nothing, of the empty text, with and without new
function made() { return [new RegExp(404), new RegExp(null), new RegExp(undefined), new RegExp(true), new RegExp(), new RegExp(""), RegExp(1.5), RegExp(), new RegExp(-0), new RegExp(undefined, "g"), new RegExp(404, undefined)]; }
function deed() {
  return made().map(re => re.source + "/" + re.flags + " " + re.test("404 null undefined true 1x5 0") + " " + re.lastIndex).join(" | ");
}
function refused() { try { return new RegExp(404, 5); } catch (e) { return e.name; } }
for (let turn = 0; turn < 3; turn++)
  console.log(deed(), made()[0] === made()[0], String(refused()));
