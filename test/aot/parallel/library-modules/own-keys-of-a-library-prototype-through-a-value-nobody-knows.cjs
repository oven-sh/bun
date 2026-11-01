// The members of the prototype object of a library class are found by name alone; whoever lists its own keys has every name. Here the prototype object comes back out of an
// object that nobody knows, so the compiler sees `Reflect.ownKeys(<a value nobody knows>)`: that value stands for all that has gone out of sight, the prototype object too.
// It used to answer "'unsubscribe' was not compiled into this executable because your code never calls it".
const dc = require("node:diagnostics_channel");
const channel = dc.channel("x");
channel.subscribe(function listener() {});
const prototype = Object.getPrototypeOf(channel);
function walk(x) {
  const out = [];
  for (const key of Reflect.ownKeys(x)) {
    if (key === "constructor") continue;
    let value;
    try {
      value = x[key];
    } catch (error) {
      out.push(String(key) + ": reading throws " + error.constructor.name);
      continue;
    }
    if (typeof value !== "function") {
      out.push(String(key) + ": " + typeof value);
      continue;
    }
    for (const receiver of [{}, 5, undefined, channel]) {
      try {
        out.push(String(key) + " on " + typeof receiver + ": " + String(value.call(receiver, 5, "six")));
      } catch (error) {
        out.push(String(key) + " on " + typeof receiver + ": throws " + error.constructor.name);
      }
    }
  }
  return out;
}
const box = JSON.parse(process.env.BOX ?? "{}");
box.held = prototype;
for (const line of walk(box.held)) console.log(line);
