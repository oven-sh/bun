// Exit code: 1
// What nothing on the stack can tell, and what is copied in.
const frames = error => String(error.stack).split("\n").slice(1, 7).map(line => line.trim().replace(/^at /, "").replace(/\(?[^ (]*\.mjs:/, "(").replace(/^\((\d+:\d+)$/, "($1)")).join(" < ");
function attempt(label, run) { try { run(); console.log(label + ": nothing"); } catch (error) { console.log(label + ": " + frames(error)); } }
function fail(value) { throw new TypeError("mine " + value); }
function chooses(value) { return value ? fail(value) : fail(0); }
function twoStatements(value) { if (value) return fail(value); return fail(0); }
let hidden = [fail];
function twoByValue(value) { if (value) return hidden[0](value); return hidden[0](0); }
function again(value) { if (!value) throw new Error("end"); return again(value - 1); }
function ping(value) { if (!value) throw new Error("end"); return pong(value - 1); }
function pong(value) { return ping(value); }
function small(value) { return value.length; }
function copies(value) { return small(value); }
function copiesTwice(value) { return copies(value); }
function renamed(value) { return fail(value); }
Object.defineProperty(renamed, "name", { value: "another" });
function shown(value) { return fail(value); }
shown.displayName = "displayed";
for (const f of [chooses, twoStatements, twoByValue, again, ping, copies, copiesTwice, renamed, shown]) {
  for (const value of [1, 0, null]) {
    attempt(f.name + " " + value + ", called", () => { f(value); });
    attempt(f.name + " " + value + ", new", () => { new f(value); });
    attempt(f.name + " " + value + ", reflected", () => { Reflect.construct(f, [value]); });
    attempt(f.name + " " + value + ", proxy", () => { new (new Proxy(f, {}))(value); });
  }
}
function warm(f, value) { let last; for (let i = 0; i < 2000; i++) { try { i & 1 ? new f(value) : f(value); } catch (error) { last = error; } } return frames(last); }
for (const f of [chooses, copies, copiesTwice, again]) console.log("warm " + f.name + ": " + warm(f, null) + " | " + warm(f, 1));
function overflow(value) { return overflow2(value); }
function overflow2(value) { return 1 + overflow2(value); }
try { new overflow(1); } catch (error) { console.log("overflow: " + error.constructor.name + " " + String(error.stack).split("\n").length); }
