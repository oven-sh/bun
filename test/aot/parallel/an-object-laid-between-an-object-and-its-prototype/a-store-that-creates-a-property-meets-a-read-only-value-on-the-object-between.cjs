// A store that would create a property on a literal: out of sight an object with a read-only value under that name is laid between the literal and Object.prototype.
class F { constructor() { this.a = 1; } f() { return 1; } }
class Sub extends F { constructor() { super(); this.b = 2; } s() { return 2; } }
class Other { constructor() { this.c = 3; } }
const named = text => JSON.parse('"' + text + '"');
const lay = Object[named("setPrototypeOf")], create = Object[named("create")], construct = Reflect[named("construct")];
const moved = new F();
lay(moved, Sub.prototype);
const belowNobody = new F();
lay(belowNobody, create(F.prototype));
const twoBetween = new F();
lay(twoBetween, create(Sub.prototype));
const late = new F();
const caught = [];
const notes = [{ a: 1 }, { a: 2 }, { a: 3 }];
const between = create(Object.prototype);
Object[named("defineProperty")](between, "made", { value: "fixed", writable: false });
const things = [new F(), new Sub(), new Other(), construct(F, [], Sub), moved, belowNobody, twoBetween, late, new F(), new Sub(), new Other()];
things[0].opt = "own";
function tell() {
  let bits = 0;
  for (let i = 0; i < things.length; i++) {
    const thing = things[i];
    bits = bits * 8 % 1000003;
    if (thing instanceof Sub) bits += 4;
    if (thing instanceof F) bits += 2;
    if (thing instanceof Other) bits += 1;
  }
  return bits;
}
function sort() {
  let sum = 0;
  for (let i = 0; i < things.length; i++) {
    const thing = things[i];
    if (thing instanceof Other) sum += 1;
    else if (thing instanceof Sub) sum += 10;
    else if (thing instanceof F) sum += 100;
    else sum += 1000;
  }
  return sum;
}
function ask(turn) {
  let text = "";
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (turn >= 100) note.made = i; text += typeof note.made + " " + String(note.made) + ",";
  }
  return text + "caught " + caught.length;
}
const set = Reflect[named("set")], define = Object[named("defineProperty")];
const is = (made, value) => Reflect.apply(Function.prototype[Symbol.hasInstance], made, [value]);
const marks = () => things.map(thing => (is(Sub, thing) ? 4 : 0) + (is(F, thing) ? 2 : 0) + (is(Other, thing) ? 1 : 0));
const bitsOf = list => list.reduce((bits, mark) => bits * 8 % 1000003 + mark, 0);
const sumOf = list => list.reduce((sum, mark) => sum + (mark & 1 ? 1 : mark & 4 ? 10 : mark & 2 ? 100 : 1000), 0);
const deeds = { quiet() {}, done() {  } };
const deed = deeds[JSON.parse('["quiet"]')[0]];
let last = "";
const said = [];
for (let turn = 0; turn < 300; turn++) {
  if (turn === 100) lay(notes[1], between);
  if (turn === 170) lay(late, Other.prototype);
  if (turn === 200) { deed(); }
  if (turn === 230) things.push(new F(), new Sub(), new Other());
  const answer = tell() + ":" + sort();
  const twin = marks();
  const line = twin.join("") + ":" + (bitsOf(twin) + ":" + sumOf(twin) === answer ? "agrees" : "parts") + ":" + answer + ":" + ask(turn);
  if (last !== line) { last = line; for (const part of (turn + ":" + line).split(/[:,]/)) console.log("SAID " + part); }
}
console.log("SAID end");
