const log = [];

function touch(parcel) {
  return parcel.weight;
}

function touchTwice(parcel) {
  parcel.weight;
  parcel.weight;
}

function attempt(label, run) {
  try {
    run();
    console.log(label, "returned", log.join());
  } catch (error) {
    console.log(label, "threw", error.constructor.name, log.join());
  }
  log.length = 0;
}

const honest = { weight: 1 };
for (let i = 0; i < 2000; i++) touch(honest);

const values = (0, eval)(`({
  counting: { get weight() { log.push("getter"); return 2; } },
  throwing: { get weight() { log.push("getter"); throw new RangeError("no weight"); } },
  trapped: new Proxy({}, { get(target, key) { log.push("get " + String(key)); return 3; } }),
  nothing: undefined,
  empty: null,
  text: "text",
})`.replaceAll("log.push", "globalThis.seen.push"));
globalThis.seen = log;
values.inherited = Object.create(values.counting);
values.honest = honest;

for (const name of Object.keys(values)) {
  attempt("touch " + name, () => {
    touch(values[name]);
  });
  attempt("touch twice " + name, () => {
    touchTwice(values[name]);
  });
  attempt("through call " + name, () => {
    touch.call(undefined, values[name]);
  });
}
