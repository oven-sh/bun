// Each evaluation of a literal makes an object of its own. Where nobody can tell, a build may hand out one object for all of them: here somebody can.
function make() {
  return /x+/;
}
function inLoop() {
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(/x+/g);
  return seen;
}
function tagged(i) {
  const re = /x+/;
  const had = re.tag;
  re.tag = i;
  return [had, re.tag, re.test("xx")];
}
function counted(text) {
  const re = /x/g;
  const before = re.lastIndex;
  re.test(text);
  return [before, re.lastIndex];
}
function compared(text) {
  let last;
  const answers = [];
  for (let i = 0; i < 3; i++) {
    const re = /y/;
    answers.push(re === last, re.test(text));
    last = re;
  }
  return answers;
}
const kept = new Set();
function held(text) {
  const re = /z/;
  kept.add(re);
  return re.test(text);
}
const weak = new WeakMap();
function marked(text) {
  const re = /w/;
  const was = weak.has(re);
  weak.set(re, text);
  return [was, re.test(text)];
}
console.log(make() === make(), make() == make(), Object.is(make(), make()));
const list = inLoop();
console.log(list[0] === list[1], list[1] === list[2], new Set(list).size);
list[0].lastIndex = 7;
console.log(list.map(re => re.lastIndex).join());
console.log(JSON.stringify([tagged(1), tagged(2), tagged(3)]));
console.log(JSON.stringify([counted("axbx"), counted("axbx"), counted("none")]));
console.log(compared("y").join());
console.log(held("z"), held("a"), held("z"), kept.size);
console.log(JSON.stringify([marked("w"), marked("w")]));
