// STATISTIC: AssignedMemberGuardsCounted >= 3
// Methods that capture a variable, called on objects of any of several heirs: most heirs have no object at first.
var town = {};
(function (town) {
  town.above = function (heir, base) { function Between() {} Between.prototype = base.prototype; heir.prototype = new Between(); heir.prototype.constructor = heir; };
  function House(next) { this.next = next; this.lamps = 0; }
  function Mill(next) { House.call(this, next); }
  function Barn(next) { House.call(this, next); }
  function Shed(next) { House.call(this, next); }
  function Inn(next) { House.call(this, next); }
  town.House = House; town.Mill = Mill; town.Barn = Barn; town.Shed = Shed; town.Inn = Inn;
})(town);
(function () {
  var H = town.House; H.hall = 2; H.porch = 1;
  H.prototype.hallLit = function () { return this.lamps >= H.hall; };
  H.prototype.porchLit = function () { return this.lamps % H.hall === H.porch; };
  H.prototype.weight = function () { return H.porch + 2; };
  var m = town.Mill, b = town.Barn, s = town.Shed, i = town.Inn;
  town.above(m, town.House); town.above(b, town.House); town.above(s, town.House); town.above(i, town.House);
  m.prototype.kind = function () { return "mill"; };
  b.prototype.kind = function () { return "barn"; };
  s.prototype.kind = function () { return "shed"; };
})();
function makeBarn(next) { return new town.Barn(next); }
function makeMill(next) { return new town.Mill(next); }
function makeShed(next) { return new town.Shed(next); }
function makeInn(next) { return new town.Inn(next); }
const builders = [{ raise: makeBarn }, { raise: makeMill }, { raise: makeShed }, { raise: makeInn }];
function make(kind, next) { return builders[kind].raise(next); }
function list(kinds) { let first = null; for (const kind of kinds) first = make(kind, first); return first; }
function count(first) {
  let halls = 0, porches = 0, weight = 0;
  for (let house = first; house; house = house.next) {
    if (house.hallLit()) halls++;
    if (house.porchLit()) porches++;
    weight += house.weight();
    house.lamps = house.lamps + 1 & 3;
  }
  return halls + porches * 8 + weight * 64;
}
const out = [];
const barns = list([0, 0, 0, 0]);
for (let k = 0; k < 5; k++) out.push(count(barns));
const two = list([0, 2, 0, 2]);
for (let k = 0; k < 5; k++) out.push(count(two), count(barns));
Bun.gc(true);
const all = list([0, 1, 2, 3]);
for (let k = 0; k < 5; k++) out.push(count(all), count(two));
console.log(out.join(" "), barns.kind());
