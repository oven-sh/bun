// The prototype object of a constructor function is `process`. An instance goes behind a Proxy, and whoever holds the Proxy reads the members of `process` under computed keys.
const computed = text => text.split("").join("");
function Below() {}
Below.prototype = process;
class Heir extends Below {}
for (const [name, instance] of Object.entries({ constructed: new Below(), derived: new Heir() })) {
  const holder = new Proxy(instance, {});
  const read = [];
  for (const key of [
    "stdout",
    "stderr",
    "stdin",
    "allowedNodeEnvironmentFlags",
    "env",
    "versions",
    "hrtime",
    "finalization",
  ]) {
    const value = holder[computed(key)];
    read.push(key + " " + typeof value + (typeof value === "function" ? " " + value.length : ""));
  }
  console.log(name, read.join());
}
