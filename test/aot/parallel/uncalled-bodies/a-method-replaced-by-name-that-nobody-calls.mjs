// Flags: --aot-harden=proof-checks
// Nobody calls run, but a call of other closures reaches it: the build said that its store is an effect that nobody counted.
const out = [];
function tell(label, read) {
  let result;
  try {
    result = read();
  } catch (error) {
  }
  out.push(label + "=" + (typeof result === "function" ? "function" : typeof result === "object" && result !== null ? "object" : Object.is(result, -0) ? "-0" : String(result)));
}
function Kind0(a) {
}
Kind0.prototype.step = function () {
  this.b = (this.b | 0) + 1;
};
try {
  Kind0.prototype.run = function () {
  };
} catch (error) {
  out.push((error).name);
}
let object0;
try {
  object0 = new Kind0(1);
} catch (error) {
  out.push((error).name);
}
try {
  Kind0.prototype["run"] = function () {
    this.b = (this.b | 0) + 1;
    return this.b;
  };
} catch (error) {
  out.push((error).name);
}
function use0(o, times) {
  let total = 0;
  for (let k = 0; k < times; k++) {
    tell("r03", () => o.run && 1);
  }
  out.push("t" + total);
}
function use1(o, times) {
  let total = 0;
  for (let k = 0; k < times; k++) {
    tell("r10", () => Object.hasOwn(o, "kind"));
    tell("r11", () => (o.constructor).run);
    tell("r12", () => o instanceof Kind0 ? o.size : "other");
    tell("r13", () => o.step(k));
  }
  out.push("t" + total);
}
try {
  use0(object0, 1);
} catch (error) {
  out.push((error).name);
}
try {
  use1(object0, 1);
} catch (error) {
  out.push((error).name);
}
console.log(out.join("\n"));
