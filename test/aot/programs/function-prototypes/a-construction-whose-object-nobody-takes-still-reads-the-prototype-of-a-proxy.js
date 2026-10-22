// `new F()` whose object nobody takes reads F.prototype, which nobody can tell where F is a function of the program. Where new.target is a proxy or a bound function the read is seen or goes elsewhere.
const log = [];
function Plain(x) { if (x > 1e9) log.push("big"); }
function Counted(x) { Counted.made++; }
Counted.made = 0;
class Base { constructor(x) { if (x > 1e9) log.push("big"); } }

for (let i = 0; i < 30000; i++) {
  new Plain(i);
  new Counted(i);
  new Base(i);
}
console.log(log.length, Counted.made);

const watched = new Proxy(Plain, { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); } });
for (let i = 0; i < 3; i++) Reflect.construct(Plain, [i], watched);
new watched(1);
console.log(log.join(","));

log.length = 0;
const throwing = new Proxy(Base, { get(target, key) { if (key === "prototype") throw new Error("no prototype"); return target[key]; } });
try { Reflect.construct(Base, [1], throwing); log.push("made"); } catch (error) { log.push(error.message); }
try { Reflect.construct(Plain, [1], throwing); log.push("made"); } catch (error) { log.push(error.message); }
const { proxy, revoke } = Proxy.revocable(Plain, {});
revoke();
try { Reflect.construct(Plain, [1], proxy); log.push("made"); } catch (error) { log.push(error.constructor.name); }
console.log(log.join(","));

const bound = Plain.bind(null, 2);
console.log(Object.getPrototypeOf(new bound()) === Plain.prototype, Object.getPrototypeOf(Reflect.construct(Plain, [], bound)) === Object.prototype);
