// A class below constructor functions whose prototype objects hold what no record declares: laid under computed keys, as node's Duplex takes the methods of Writable.
// The class lays a member of its own under one of those names: a lookup stops there.
//
const unseen = (0, eval);
function Writable() {}
Writable.prototype.destroy = function () { return "destroy of Writable"; };
Writable.prototype.end = function () { return "end of Writable"; };
function Duplex() {}
for (const name of Object.keys(Writable.prototype)) Duplex.prototype[name] = Writable.prototype[name];

class Socket extends Duplex {
  destroy() { return "destroy of Socket, then " + super.destroy(); }
  other() { return "other of Socket"; }
}
class Tls extends Socket {
  other() { return "other of Tls"; }
}
globalThis.kept = [Socket, Tls];
function close(s) { return s.destroy() + " | " + s.other() + " | " + s.end(); }
function run() { let said = ""; for (const s of [new Socket(), new Tls()]) { try { said += close(s) + "\n"; } catch (error) { said += "thrown: " + error.name + "\n"; } } return said; }
console.log(run());
try {
  delete Socket.prototype.destroy;
} catch (error) {
  console.log("thrown: " + error.name);
}
console.log(run());
