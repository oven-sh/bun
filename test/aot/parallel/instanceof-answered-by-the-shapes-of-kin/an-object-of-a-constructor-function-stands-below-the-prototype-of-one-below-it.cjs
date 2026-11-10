// Sub.prototype is a plain object made below F.prototype, and hides nothing of it. An object that F has made and that is laid below Sub.prototype is a Sub, though its shape is F's.
function F() { this.a = 1; }
F.prototype.f = function () { return 1; };
function Sub() { this.b = 2; }
Sub.prototype = Object.create(F.prototype);
Sub.prototype.s = function () { return 2; };
function Other() { this.c = 3; }
const named = text => JSON.parse('"' + text + '"');
const lay = Object[named("setPrototypeOf")], create = Object[named("create")], construct = Reflect[named("construct")];
const moved = new F();
lay(moved, Sub.prototype);
const belowNobody = new F();
lay(belowNobody, create(F.prototype));
const twoBetween = new F();
lay(twoBetween, create(Sub.prototype));
const late = new F();
const things = [new F(), new Sub(), new Other(), construct(F, [], Sub), moved, belowNobody, twoBetween, late, new F(), new Sub(), new Other()];
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
const said = [];
for (let turn = 0; turn < 240; turn++) {
  if (turn === 100) lay(late, Sub.prototype);
  if (turn === 170) lay(late, Other.prototype);
  const answer = tell() + ":" + sort();
  if (said[said.length - 1] !== answer) said.push(turn, answer);
}
console.log(said.join());
