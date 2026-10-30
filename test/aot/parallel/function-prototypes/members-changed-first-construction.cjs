// The class of a constructor function is looked at when the function first constructs. Everything below is done to the functions BEFORE that, under keys that only the run knows,
// and the sites that call the members are reached first by instances of another function, so what they test has been tested before anybody has looked at the changed one.
const key = reversed => reversed.split("").reverse().join("");

function Plain(x) { this.x = x; }
Plain.prototype.m = function () { return "Plain.m " + this.x; };
Plain.prototype.n = function () { return "Plain.n " + this.m(); };

function Replaced(x) { this.x = x; }
Replaced.prototype.m = function () { return "Replaced.m " + this.x; };
Replaced.prototype.n = function () { return "Replaced.n " + this.m(); };

function Deleted(x) { this.x = x; }
Deleted.prototype.m = function () { return "Deleted.m " + this.x; };
Deleted.prototype.n = function () { return "Deleted.n " + typeof this.m; };

function Swapped(x) { this.x = x; }
Swapped.prototype.m = function () { return "Swapped.m " + this.x; };
Swapped.prototype.n = function () { return "Swapped.n " + this.m(); };

function Base(x) { this.x = x; }
Base.prototype.m = function () { return "Base.m " + this.x; };
function Below(x) { this.x = x; }
Object.setPrototypeOf(Below.prototype, Base.prototype);
Below.prototype.n = function () { return "Below.n " + this.m(); };

function Relinked(x) { this.x = x; }
Object.setPrototypeOf(Relinked.prototype, Base.prototype);
Relinked.prototype.n = function () { return "Relinked.n " + this.m(); };

function Accessor(x) { this.x = x; }
Accessor.prototype.m = function () { return "Accessor.m " + this.x; };
Accessor.prototype.n = function () { return "Accessor.n " + this.m(); };

function Setter(x) { this.x = x; }
Setter.prototype.n = function () { return "Setter.n " + this.x + " " + this.seen; };

Replaced.prototype[key("m")] = function () { return "put there later " + this.x; };
delete Deleted.prototype[key("m")];
Swapped[key("epytotorp")] = { m() { return "another object's m " + this.x; }, n() { return "another object's n " + this.m(); } };
Below.prototype[key("m")] = function () { return "hides Base.m " + this.x; };
Object.setPrototypeOf(Relinked.prototype, { m() { return "another parent's m " + this.x; } });
Object.defineProperty(Accessor.prototype, key("m"), { configurable: true, get() { return () => "made by a getter " + this.x; } });
Object.defineProperty(Setter.prototype, key("x"), { configurable: true, set(value) { this.seen = "setter got " + value; }, get() { return "getter"; } });

function callM(object) { return object.m(); }
function callN(object) { return object.n(); }
function onPaper(Function, value) { return new Function(value).n(); }

const out = [];
for (let round = 0; round < 3; round++) {
  out.push(callM(new Plain(round)), callN(new Plain(round)));
}
for (let round = 0; round < 3; round++) {
  out.push(new Replaced(round).n(), new Deleted(round).n(), new Swapped(round).n(), new Below(round).n(), new Relinked(round).n(), new Accessor(round).n(), new Setter(round).n());
}
for (const Function of [Plain, Replaced, Swapped, Below, Relinked, Accessor]) {
  out.push(callM(new Function(7)), callN(new Function(8)), onPaper(Function, 9));
}
out.push(callN(new Deleted(7)), onPaper(Deleted, 9), callN(new Setter(7)), onPaper(Setter, 9));
console.log(out.join("\n"));
