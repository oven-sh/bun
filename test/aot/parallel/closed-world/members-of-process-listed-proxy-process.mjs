// A Proxy without traps stands for `process`: whoever holds the Proxy lists the members of `process`, reads them under computed keys and copies them.
const roads = {
  constructed: () => new Proxy(process, {}),
  revocable: () => Proxy.revocable(process, {}).proxy,
  twice: () => new Proxy(new Proxy(process, {}), {}),
  below: () => Object.create(new Proxy(process, {})),
};
const late = /^(std|final|allowedNode)/;
for (const [name, take] of Object.entries(roads)) {
  const handed = take();
  const read = [];
  for (const key in handed) if (late.test(key)) read.push(key + " " + typeof handed[key]);
  console.log(name, read.join());
  if (name === "below") continue;
  console.log(
    name,
    Object.entries(handed)
      .filter(([key]) => late.test(key))
      .map(([key, value]) => key + " " + typeof value)
      .join(),
  );
  console.log(
    name,
    typeof { ...handed }.stdout.write,
    handed.stdout === process.stdout,
    Reflect.ownKeys(handed).filter(key => late.test(String(key))).length,
  );
}
