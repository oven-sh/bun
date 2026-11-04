// g and y begin at lastIndex and store it. A literal that is written where it is matched with begins at 0 each time, and one that is kept goes on where it stopped.
function testEachTime(text) {
  return [/a/g.test(text), /a/g.test(text), /a/y.test(text), /a/y.test(text), /a/gy.test(text)];
}
function execEachTime(text) {
  const found = [];
  for (let i = 0; i < 3; i++) found.push(/a/g.exec(text).index, /b/y.exec(text), /\w/y.exec(text)[0]);
  return found;
}
function walk(text) {
  const re = /a(.)/g;
  const found = [];
  let match;
  while ((match = re.exec(text))) found.push(match.index, match[1], re.lastIndex);
  found.push(re.lastIndex);
  return found;
}
function outsideLoop(text) {
  const re = /a/g;
  const answers = [];
  for (let i = 0; i < 4; i++) answers.push(re.test(text), re.lastIndex);
  return answers;
}
function stickyWalk(text) {
  const re = /\d/y;
  const found = [];
  while (re.test(text)) found.push(re.lastIndex);
  return found;
}
function from(text, start) {
  const re = /a/g;
  re.lastIndex = start;
  const match = re.exec(text);
  return [match && match.index, re.lastIndex];
}
function fromObject(text) {
  const re = /a/g;
  const log = [];
  re.lastIndex = { valueOf() { log.push("asked"); return 2; } };
  const match = re.exec(text);
  return [match && match.index, re.lastIndex, log.join()];
}
function plainKeeps(text) {
  const re = /a/;
  re.lastIndex = 5;
  return [re.test(text), re.lastIndex, re.exec(text).index, re.lastIndex];
}
function methodsOfStrings(text) {
  const all = /a/g;
  all.lastIndex = 3;
  const first = [text.replace(all, "-"), all.lastIndex];
  all.lastIndex = 3;
  const second = [text.match(all).length, all.lastIndex];
  all.lastIndex = 3;
  const third = [text.search(all), all.lastIndex];
  all.lastIndex = 3;
  const fourth = [text.split(all).length, all.lastIndex];
  all.lastIndex = 3;
  const fifth = [[...text.matchAll(all)].length, all.lastIndex];
  const sticky = /a/y;
  sticky.lastIndex = 2;
  const sixth = [text.replace(sticky, "-"), sticky.lastIndex, text.replace(sticky, "-"), sticky.lastIndex];
  return [first, second, third, fourth, fifth, sixth];
}
function written(text) {
  return [text.replace(/a/g, "-"), text.replace(/a/y, "-"), text.replace(/b/y, "-"), text.match(/a/g).length, text.match(/b/y), text.search(/b/g), text.search(/b/y), text.split(/b/g).length, text.replaceAll(/a/g, "+")];
}
function calledBack(text) {
  // The function that replaces comes back here, to the same literal.
  let depth = 0;
  const again = s => s.replace(/a/g, m => (depth++ < 2 ? "[" + again("xaya") + "]" : m.toUpperCase()));
  return again(text);
}
// Twice: what the first evaluation left behind would show in the second.
for (let round = 0; round < 2; round++) {
  console.log(testEachTime("ba").join());
  console.log(execEachTime("cab").join());
  console.log(walk("axbayaz").join());
  console.log(outsideLoop("aXa").join());
  console.log(stickyWalk("123x4").join());
  console.log(JSON.stringify([from("aaa", 0), from("aaa", 1), from("aaa", 3), from("aaa", 9), from("aaa", -1)]));
  console.log(JSON.stringify(fromObject("aaaa")));
  console.log(plainKeeps("xa").join());
  console.log(JSON.stringify(methodsOfStrings("aabaa")));
  console.log(JSON.stringify(written("aabaa")));
  console.log(calledBack("a-a"));
}
