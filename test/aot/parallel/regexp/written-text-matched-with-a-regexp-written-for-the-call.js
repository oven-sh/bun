// a written text is replaced, matched and tested with a RegExp that is written for the call, with g and y, straight and in a loop; one RegExp made in front of a loop keeps its lastIndex
function replaced() { return "a-b-c".replace(/-/g, "_") + "|" + "a-b-c".replace(/-/, "_") + "|" + "a-b-c".replace(/(\w)-(\w)/, "$2-$1") + "|" + "a-b-c".replaceAll(/-/g, ""); }
function tested() { return [/^v\d/.test("v1"), /^v\d/.test("w1"), /b/g.test("abc"), /b/y.test("abc")].join(); }
function searched() { return ["a-b-c".search(/-/), "abc".search(/x/)].join(); }
function keptInFront() {
  const each = /a/g;
  let log = "";
  for (let turn = 0; turn < 4; turn++)
    log += each.test("aa") + ":" + each.lastIndex + " ";
  return log;
}
function keptUnread() {
  const each = /a/g;
  let log = "";
  for (let turn = 0; turn < 4; turn++)
    log += each.test("aa") + " ";
  return log;
}
for (let turn = 0; turn < 3; turn++)
  console.log(replaced(), tested(), searched(), keptInFront(), keptUnread());
