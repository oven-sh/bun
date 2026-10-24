// One plain function is constructed, called on an object of the program, and called without a receiver. The build does not see under which name the function is constructed.
"use strict";
function hide(callable) { return callable; }
const Meter = hide(function Meter() { seen.push(this === undefined ? "none" : this instanceof Meter ? "instance" : typeof this.tag); return this; });
const seen = [];
const made = new Meter();
const given = Meter.call({ tag: "t" });
const none = Meter();
console.log(seen.join(), made instanceof Meter, given.tag, none);
