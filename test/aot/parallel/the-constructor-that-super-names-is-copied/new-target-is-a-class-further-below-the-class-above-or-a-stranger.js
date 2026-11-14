// The constructor of Noted runs for Noted, for a class below it, and by Reflect.construct for the class below, for the class above and for a function that is no class: the object stands below the prototype of whoever it is made for, with the fields of Plain and Noted.
class Plain { id; constructor(id) { this.id = id; this.who = new.target.name; } }
class Noted extends Plain { mark; constructor(id) { super(id); this.mark = id + 1; } }
class Below extends Noted { deep = "d"; constructor(id) { super(id); this.low = id; } }
function Stranger() { }
function parentOf(made) {
  const parent = Object.getPrototypeOf(made);
  return parent === Plain.prototype ? "Plain" : parent === Noted.prototype ? "Noted" : parent === Below.prototype ? "Below" : parent === Stranger.prototype ? "Stranger" : "?";
}
function make(i) {
  switch (i % 5) {
  case 0: return new Noted(i);
  case 1: return new Below(i);
  case 2: return Reflect.construct(Noted, [i], Below);
  case 3: return Reflect.construct(Noted, [i], Plain);
  default: return Reflect.construct(Noted, [i], Stranger);
  }
}
function run(count) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const made = make(i);
    parts.push(parentOf(made) + ":" + made.id + made.who + made.mark + (made.deep ?? "-") + (made.low ?? "-") + Object.keys(made).join(""));
  }
  return parts.join(" ");
}
console.log(run(10));
