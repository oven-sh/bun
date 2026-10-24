// A loop over the names of a literal defines a getter under each; each getter keeps its own name and its own state.
const lines = [];
const source = { HOME: "/home", PORT: "80", DEBUG: undefined, NAME: "model" };
function getterFor(key, parse, unread) {
  let lastRaw = unread;
  let lastParsed;
  let parses = 0;
  return () => {
    const raw = source[key];
    if (raw !== lastRaw) {
      lastParsed = parse(raw) + ":" + ++parses;
      lastRaw = raw;
    }
    return lastParsed;
  };
}
function build(shape) {
  const accessor = {};
  for (const key of Object.keys(shape)) Object.defineProperty(accessor, key, { get: getterFor(key, shape[key], accessor), configurable: true, enumerable: key !== "DEBUG" });
  return accessor;
}
const asText = raw => String(raw);
const asNumber = raw => Number(raw) + 1;
const asFlag = raw => raw === "1";
const settings = build({ HOME: asText, PORT: asNumber, DEBUG: asFlag, NAME: asText });
lines.push(settings.HOME, settings.PORT, settings.DEBUG, settings.NAME, settings.HOME);
source.PORT = "8080";
source.DEBUG = "1";
lines.push(settings.PORT, settings.DEBUG, settings.PORT, String(settings.MISSING));
lines.push(Object.keys(settings).join(), Object.getOwnPropertyNames(settings).join(), JSON.stringify(settings));
Object.defineProperty(settings, "HOME", { get: () => "redefined" });
lines.push(settings.HOME);
delete settings.NAME;
lines.push(String(settings.NAME), "NAME" in settings);
try {
  "use strict";
  settings.PORT = 1;
  lines.push("the store is ignored: " + settings.PORT);
} catch (error) {
  lines.push(error.constructor.name);
}
const second = build({ HOME: asFlag });
lines.push(second.HOME, settings.HOME, Object.getOwnPropertyDescriptor(second, "HOME").get === Object.getOwnPropertyDescriptor(second, "HOME").get);
console.log(lines.join("\n"));
