// The table lists every member that the host puts on these prototype objects. What the program adds, replaces or deletes there is found as in plain Bun.
const inspectCustom = Symbol.for("nodejs.util.inspect.custom");
const describe = value => Object.prototype.toString.call(value);
const ownKeys = object => Reflect.ownKeys(object).map(String).sort().join(" ");

const timer = setTimeout(() => {}, 1);
const immediate = setImmediate(() => {});
clearTimeout(timer);
clearImmediate(immediate);
const made = {
  crypto,
  subtle: crypto.subtle,
  timer,
  immediate,
  timing: performance.timing,
  glob: new Bun.Glob("*.js"),
  hasher: new Bun.CryptoHasher("sha1"),
  transpiler: new Bun.Transpiler(),
};
for (const [name, value] of Object.entries(made)) {
  const prototype = Object.getPrototypeOf(value);
  console.log(name, describe(value), prototype[Symbol.toStringTag], ownKeys(value), "|", ownKeys(prototype));
  console.log(name, value.added, "added" in value, value[inspectCustom]);
  prototype.added = name + " has it";
  console.log(name, value.added, "added" in value, Object.hasOwn(value, "added"));
  prototype[inspectCustom] = function () {
    return "printed by the program: " + name;
  };
  console.log(value);
  console.log(Bun.inspect(value));
  delete prototype[inspectCustom];
  delete prototype.added;
  console.log(name, value.added, value[inspectCustom]);
}

console.log(BuildMessage.prototype.name, ResolveMessage.prototype.name, describe(BuildMessage.prototype));

// `timing` and toJSON().timing are one object.
console.log(performance.toJSON().timing === performance.timing, performance.timing === performance.timing);
performance.timing.first = 1;
console.log(performance.toJSON().timing.first);
performance.toJSON().timing.second = 2;
console.log(performance.timing.second, Object.keys(performance.timing));

// The handler that was stored comes back, and null after what is no object.
const handler = () => {};
performance.onresourcetimingbufferfull = handler;
console.log(performance.onresourcetimingbufferfull === handler);
performance.onresourcetimingbufferfull = 1;
console.log(performance.onresourcetimingbufferfull);

const digest = SubtleCrypto.prototype.digest;
SubtleCrypto.prototype.digest = function () {
  return "replaced";
};
console.log(crypto.subtle.digest("SHA-1", new Uint8Array(1)));
SubtleCrypto.prototype.digest = digest;
console.log(Buffer.from(await crypto.subtle.digest("SHA-1", new Uint8Array(1))).toString("hex"));
for (const getter of ["timing", "timeOrigin"]) {
  try {
    console.log(Reflect.get(Performance.prototype, getter, {}));
  } catch (error) {
    console.log(getter, error.name);
  }
}
