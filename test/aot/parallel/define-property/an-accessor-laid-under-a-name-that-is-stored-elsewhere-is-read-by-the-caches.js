// COUNT: operation:operationAOTGetById <= 1500
// COUNT: operation:operationAOTGetGeneric <= 2500
// `Object.defineProperties(server, { genReqId: { get() { return this[kGenReqId]; } } })`, as fastify lays a dozen accessors on its one server: the name is a field of the layout that is appended out of line,
// a field that may exist without storage, and the accessor lies among the extra properties. The read was filed as "the slot of the field", found the slot empty, and came to the run time at every read:
// 2,600 instructions a request. What the Structure lists among the extra properties lies there in every object of the Structure.
const kMake = Symbol("make");
function build(name, lays) {
  const server = { [kMake]() { return name; }, name };
  if (lays === "accessor") Object.defineProperties(server, { make: { configurable: true, get() { return this[kMake]; } }, version: { configurable: true, get() { return 5; } } });
  else if (lays === "value") Object.defineProperties(server, { make: { configurable: true, writable: true, value: () => "value of " + name }, version: { configurable: true, value: 6 } });
  else if (lays === "store") { server.make = () => "stored on " + name; server.version = 7; }
  else if (lays === "undefined") { server.make = undefined; server.version = undefined; }
  return server;
}
const kinds = ["accessor", "value", "store", "undefined", "nothing"];
const servers = kinds.map(kind => build(kind, kind));
function ask(server) {
  const make = server.make;
  return (make ? make.call(server) : String(make)) + " " + server.version;
}
function askAll(rounds) {
  let length = 0;
  for (let round = 0; round < rounds; round++) length += ask(servers[round % servers.length]).length;
  return length;
}
function describe() {
  return servers.map(server => ask(server) + " [" + Object.keys(server).join() + "] " + Object.hasOwn(server, "make") + " " + ("version" in server)).join(" | ");
}
console.log(describe());
console.log(askAll(50000));
// Each changes what it has under the name, and the others go on as they were.
Object.defineProperty(servers[0], "make", { configurable: true, get() { return () => "another getter"; } });
console.log(describe());
Object.defineProperty(servers[0], "make", { configurable: true, writable: true, enumerable: true, value: () => "a value now" });
delete servers[1].make;
Object.defineProperty(servers[2], "version", { configurable: true, get() { return 70; } });
servers[3].make = () => "stored late";
Object.defineProperty(servers[4], "make", { configurable: true, get() { return () => "laid late"; }, set(value) { this.taken = value; } });
console.log(describe());
console.log(askAll(5000));
servers[4].make = 1;
delete servers[0].make;
servers[0].make = () => "stored again";
delete servers[2].version;
Object.setPrototypeOf(servers[1], { get make() { return () => "from above"; }, version: 60 });
delete servers[1].version;
console.log(describe());
console.log(askAll(5000));
