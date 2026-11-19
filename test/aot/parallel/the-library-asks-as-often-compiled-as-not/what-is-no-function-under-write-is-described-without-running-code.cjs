const kinds = {
  "an accessor under constructor": { get constructor() { console.log("  the accessor is run"); return Object; } },
  "a symbol": Symbol("s"),
  "a tag": { [Symbol.toStringTag]: "Tagged" },
  "a literal": {},
  "an instance": new (class Crate {})(),
  "below nothing": Object.create(null),
  "a list": [],
  "a text": "text",
  "a number": 7,
  "a big integer": 7n,
  "true": true,
  "null": null,
  "undefined": undefined,
  "a proxy": new Proxy({}, { get() { console.log("  the proxy is asked"); }, getPrototypeOf() { console.log("  the proxy is asked for what is above"); return null; } }),
};
for (const name of Object.keys(kinds)) {
  console.log(name);
  try {
    process.stdout.write.call({ _write: kinds[name] }, "x");
  } catch (error) {
    console.log("  " + error.constructor.name + ": " + error.message);
  }
}
