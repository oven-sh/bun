function replacement() {
  return "replaced";
}

function change(object, key) {
  const was = Object.getOwnPropertyDescriptor(object, key);
  const answers = [];
  const note = (way, run) => {
    let answer;
    try {
      answer = String(run());
    } catch (error) {
      answer = error.name;
    }
    const now = Object.getOwnPropertyDescriptor(object, key);
    answers.push(way + " " + answer + (now && now.value === was.value ? " unchanged" : " changed"));
    Object.defineProperty(object, key, was);
  };
  note("store", () => {
    object[key] = replacement;
    return "done";
  });
  note("Reflect.set", () => Reflect.set(object, key, replacement));
  note("define", () => {
    Object.defineProperty(object, key, { value: replacement, writable: true, configurable: true });
    return "done";
  });
  note("Reflect.defineProperty", () => Reflect.defineProperty(object, key, { get: replacement, configurable: true }));
  note("delete", () => delete object[key]);
  note("Reflect.deleteProperty", () => Reflect.deleteProperty(object, key));
  return answers.join(", ");
}

// This one comes straight from its global name. The others come out of a list.
console.info("console.debug: " + change(console, "debug"));
const rows = [
  ["Promise", Promise, ["try"]],
  ["Math", Math, ["random", "sign"]],
  ["JSON", JSON, ["parse", "stringify"]],
  ["Date", Date, ["now", "parse"]],
  ["Number", Number, ["parseFloat", "parseInt"]],
  ["Map", Map, ["groupBy"]],
  ["RegExp", RegExp, ["escape"]],
  ["Uint8Array", Uint8Array, ["fromBase64", "fromHex"]],
];
for (const [name, object, keys] of rows)
  for (const key of keys) console.info(name + "." + key + ": " + change(object, key));
console.info(
  [
    await Promise.try(() => 1),
    Math.sign(-2),
    JSON.parse("[3]")[0],
    typeof Date.now(),
    Number.parseInt("4px"),
    Map.groupBy([5], () => "k").get("k")[0],
    RegExp.escape("."),
    Uint8Array.fromHex("06")[0],
  ].join(),
);
