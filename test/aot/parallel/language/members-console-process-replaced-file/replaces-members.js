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
    answers.push(
      way + " " + answer + (now && now.value === was.value && now.get === was.get ? " unchanged" : " changed"),
    );
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

const say = console.info.bind(console);
// This one comes straight from its global name. The others come out of a list.
say("AbortController.name: " + change(AbortController, "name"));
const rows = [
  ["console", console, ["debug", "table", "warn", "count"]],
  ["process", process, ["cwd", "hrtime", "emitWarning", "exit", "nextTick", "uptime"]],
  ["Intl", Intl, ["DateTimeFormat", "getCanonicalLocales"]],
  ["WebAssembly", WebAssembly, ["compile", "Module"]],
  ["performance", performance, ["now"]],
];
for (const [name, object, keys] of rows) for (const key of keys) say(name + "." + key + ": " + change(object, key));
say(
  [
    typeof process.cwd(),
    typeof process.uptime(),
    Intl.getCanonicalLocales("en-us")[0],
    typeof WebAssembly.compile,
    typeof performance.now(),
  ].join(),
);
