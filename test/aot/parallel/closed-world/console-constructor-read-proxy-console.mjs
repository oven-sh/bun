// `console` goes behind a Proxy, and so does an object that inherits from it. Whoever holds either reads `Console` under a computed key and constructs one.
const unknown = globalThis[["Obj", "ect"].join("")];
const computed = text => text.split("").join("");
const holders = {
  proxy: new Proxy(console, {}),
  proxyOfHeir: new Proxy(Object.create(console), {}),
  heirHandedBack: unknown(Object.create(console)),
};
for (const [name, holder] of Object.entries(holders)) {
  const Console = holder[computed("Console")];
  console.log(name, typeof Console, Console.name, Console.length);
  new Console({ stdout: process.stdout, stderr: process.stderr }).log(name, "printed by a Console made from it");
}
