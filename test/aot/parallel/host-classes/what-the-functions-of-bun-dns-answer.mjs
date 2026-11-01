// A list of strings, undefined, and promises, whatever the resolver of the machine says.
function servers() { return Bun.dns.getServers(); }
console.log(Array.isArray(servers()), typeof servers().length, servers().every(each => typeof each === "string"));
function set() { return Bun.dns.setServers([[4, "127.0.0.1", 53]]); }
try { console.log(set()); } catch (error) { console.log(error.code); }
function query() { return Bun.dns.resolve("localhost", "A"); }
const asked = query(); asked.catch(() => {});
console.log(asked instanceof Promise, typeof asked.then);
function reverse() { return Bun.dns.reverse("127.0.0.1"); }
const turned = reverse(); turned.catch(() => {});
console.log(turned instanceof Promise);
try { Bun.dns.resolve(); } catch (error) { console.log(error.name); }
process.exit(0);
