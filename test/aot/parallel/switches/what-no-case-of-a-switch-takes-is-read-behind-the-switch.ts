// what equals no case goes on under a name of its own: the subject and its holder are read in `default` and behind the switch, and a tag that lies about its holder comes from out of sight
type Circle = { kind: 1; radius: number };
type Square = { kind: 2; side: number };
type Label = { kind: 3; text: string };
type Shape = Circle | Square | Label;
function size(shape: Shape) {
  switch (shape.kind) {
    case 1: return shape.radius * 2;
    case 2: return shape.side;
    default: return shape.text.length;
  }
}
function step(kind: number) {
  switch (kind) {
    case 1: return "one";
    case 2: return "two";
  }
  return "rest " + kind + " " + typeof kind;
}
function name(word: string) {
  switch (word) {
    case "a": return "first";
    case "b": return "second";
  }
  return "rest " + word + word.length;
}
console.log(String(size({ kind: 1, radius: 2 })), String(size({ kind: 2, side: 3 })), String(size({ kind: 3, text: "four" })));
console.log(step(1), step(2), step(3), step(-0), step(NaN), step(2.5), name("a"), name("c"), name("a" + "b"));
function deed(): Shape { return JSON.parse('{"kind":7,"text":"seven","radius":1}'); }
console.log(String(size(deed())));
let total = 0;
for (let i = 0; i < 300; i++) total += size(i % 3 === 0 ? { kind: 1, radius: i } : i % 3 === 1 ? { kind: 2, side: i } : { kind: 3, text: "t" + i });
console.log(String(total));
try { console.log(String(size(JSON.parse('{"kind":9}')))); } catch (e) { console.log((e as Error).name); }
