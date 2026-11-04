// `let held; try { held = new Proxy(..); } catch { }` leaves undefined or a proxy. A read, a test and a store through it ask the trap where it is a proxy, and throw as they do for undefined where it is not.
const log = [];
const told = work => { try { return work(); } catch (error) { return error.constructor.name; } };
function say(label, value) { console.log(label + ": " + JSON.stringify(value, (key, held) => held === undefined ? "undefined" : held) + (log.length ? " | " + log.splice(0).join(" ") : "")); }
const handler = { get(target, key) { log.push("get " + String(key)); return target[key]; }, has(target, key) { log.push("has " + String(key)); return key in target; }, set(target, key, value) { log.push("set " + String(key)); target[key] = value; return true; }, ownKeys(target) { return Reflect.ownKeys(target); } };
const symbol = Symbol("s");
function made(target) { let held; try { held = new Proxy(target, handler); } catch { } return held; }
function asked(target, key) {
  let held;
  try { held = new Proxy(target, handler); } catch { }
  return [told(() => held.alpha), told(() => "alpha" in held), told(() => { held.alpha = 2; return held.alpha; }), told(() => held[key]), told(() => key in held), told(() => { held[key] = 3; return held[key]; })];
}
function askedOften(target, key, turns) {
  let held, sum = 0;
  try { held = new Proxy(target, handler); } catch { }
  for (let i = 0; i < turns; i++) { try { sum += held.alpha + (key in held ? 1 : 0) + ("alpha" in held ? 1 : 0); held.beta = i; } catch { sum -= 1; } }
  log.length = 0;
  return sum;
}
for (let round = 0; round < 3; round++) {
  for (const key of ["alpha", "other", symbol, 0, {}, { toString() { return "alpha"; } }, null, undefined]) {
    say("an object for the target", asked({ alpha: 1 }, key));
    say("nothing for the target", asked(undefined, key));
    say("a number for the target", asked(5, key));
  }
  say("made elsewhere", [{ alpha: 1 }, undefined, null, "text"].map(target => { const held = made(target); return [told(() => held.alpha), told(() => "alpha" in held), told(() => ({}) in held), told(() => { held.alpha = 4; return held.alpha; })]; }));
  say("null or a proxy", [true, false].map(makes => { const held = makes ? new Proxy({ alpha: 1 }, handler) : null; return [told(() => held.alpha), told(() => "alpha" in held), told(() => symbol in held)]; }));
  say("a number or a proxy", [true, false].map(makes => { const held = makes ? new Proxy({ alpha: 1 }, handler) : 7; return [told(() => held.alpha), told(() => "alpha" in held), told(() => { "use strict"; held.alpha = 1; return held.alpha; })]; }));
  say("a text or a proxy", [true, false].map(makes => { const held = makes ? new Proxy({ length: 1 }, handler) : "text"; return [told(() => held.length), told(() => "length" in held), told(() => held[0])]; }));
}
console.log(askedOften({ alpha: 1 }, "alpha", 30000), askedOften(undefined, "alpha", 30000), askedOften({ alpha: 1 }, {}, 30000), askedOften(null, symbol, 30000));
