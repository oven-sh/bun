// A store into the String object that an array method made from a string adds a member to that object. It is not written where a record of the same call keeps the member.
function mark(receiver) {
  Array.prototype.forEach.call(receiver, (each, index, whole) => {
    whole.h = index + 100;
    whole.g = whole;
  });
  return receiver.h;
}
const kept = [];
for (let turn = 0; turn < 2000; turn++) kept.push(new String("s" + turn), mark("ab" + turn), [turn]);
console.log(mark({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, length: 1, 0: "x" }), mark("ab"));
Bun.gc(true);
console.log(kept.length, String(kept[0]), kept[5][0], kept.filter((each, index) => index % 3 === 0).every(each => each instanceof String && each.length > 1));
