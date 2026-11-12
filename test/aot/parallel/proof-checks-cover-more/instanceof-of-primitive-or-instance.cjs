// Flags: --aot-harden=proof-checks
const list = [];
process.on("uncaughtException", error => console.log(error.constructor.name, list.length));
class Base {}
class A extends Base {}
function visit(o) {
  o instanceof A;
  o.later;
}
for (let i = 0; i < 5; i++) list.push(new A());
for (let i = 0; i < list.length; i++) globalThis.extend(list[i]);
for (let round = 0; round < 40; round++) visit(list[round]);
