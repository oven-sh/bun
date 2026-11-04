// Every built-in below is replaced, deleted or defined anew BEFORE the program uses it for the first time, under a key that only the run knows.
// Nothing is looked up before the program runs, so whoever compares with "what the realm was created with" must not take the replacement for it.
"use strict";
const seen = [];
const note = text => {
  seen[seen.length] = text;
};
const key = reversed => reversed.split("").reverse().join("");

function wrap(holder, name, label) {
  const original = holder[name];
  holder[name] = function (...args) {
    note(label);
    return Reflect.apply(original, this, args);
  };
  return original;
}

const originals = {
  stringify: wrap(JSON, key("yfignirts"), "JSON.stringify"),
  now: wrap(Date, key("won"), "Date.now"),
  parseFloat: wrap(Number, key("taolFesrap"), "Number.parseFloat"),
  hrtime: wrap(process, key("emitrh"), "process.hrtime"),
  cwd: wrap(process, key("dwc"), "process.cwd"),
  uptime: wrap(process, key("emitpu"), "process.uptime"),
  performanceNow: wrap(performance, key("won"), "performance.now"),
  dateToString: wrap(Date.prototype, key("gnirtSot"), "toString"),
  toLocaleDateString: wrap(Date.prototype, key("gnirtSetaDelacoLot"), "toLocaleDateString"),
  captureStackTrace: wrap(Error, key("ecarTkcatSerutpac"), "Error.captureStackTrace"),
  structuredClone: wrap(globalThis, key("enolCderutcurts"), "structuredClone"),
  queueMicrotask: wrap(globalThis, key("ksatorciMeueuq"), "queueMicrotask"),
};

const dateParse = Date[key("esrap")];
delete Date[key("esrap")];
Object.defineProperty(JSON, key("esrap"), {
  configurable: true,
  get() {
    note("get JSON.parse");
    return text => "parsed " + text;
  },
});
const OriginalTextEncoder = globalThis[key("redocnEtxeT")];
globalThis[key("redocnEtxeT")] = class NotTextEncoder {
  encode(text) {
    note("encode");
    return { length: -text.length };
  }
};
const OriginalNumberFormat = Intl[key("tamroFrebmuN")];
Intl[key("tamroFrebmuN")] = class NotNumberFormat {
  format(number) {
    note("format");
    return "<" + number + ">";
  }
};

function use() {
  const target = {};
  Error.captureStackTrace(target);
  let ran = false;
  queueMicrotask(() => {
    ran = true;
  });
  return [
    JSON.stringify({ d: [4] }),
    typeof Date.now(),
    Number.parseFloat("2.5x"),
    typeof process.hrtime(),
    typeof process.cwd(),
    typeof process.uptime(),
    typeof performance.now(),
    new Date(5).getTime(),
    new Date(0).toISOString(),
    typeof new Date(5).toString(),
    new Date(0).toLocaleDateString("en-US", { timeZone: "UTC" }),
    typeof target.stack,
    structuredClone({ e: 5 }).e,
    ran,
    typeof Date.parse,
    JSON.parse("[1]"),
    new TextEncoder().encode("abc").length,
    new Intl.NumberFormat("en").format(7),
  ];
}

for (let round = 0; round < 3; round++) {
  console.log(use().join(" | "));
  console.log(seen.join(", "));
  seen.length = 0;
}

console.log(
  JSON.stringify === originals.stringify,
  Date.now === originals.now,
  process.cwd === originals.cwd,
  Date.prototype.toString === originals.dateToString,
  structuredClone === originals.structuredClone,
  TextEncoder === OriginalTextEncoder,
  Intl.NumberFormat === OriginalNumberFormat,
);

JSON[key("yfignirts")] = originals.stringify;
Date[key("won")] = originals.now;
Date[key("esrap")] = dateParse;
Number[key("taolFesrap")] = originals.parseFloat;
process[key("emitrh")] = originals.hrtime;
process[key("dwc")] = originals.cwd;
process[key("emitpu")] = originals.uptime;
performance[key("won")] = originals.performanceNow;
Date.prototype[key("gnirtSot")] = originals.dateToString;
Date.prototype[key("gnirtSetaDelacoLot")] = originals.toLocaleDateString;
Error[key("ecarTkcatSerutpac")] = originals.captureStackTrace;
globalThis[key("enolCderutcurts")] = originals.structuredClone;
globalThis[key("ksatorciMeueuq")] = originals.queueMicrotask;
delete JSON[key("esrap")];
globalThis[key("redocnEtxeT")] = OriginalTextEncoder;
Intl[key("tamroFrebmuN")] = OriginalNumberFormat;

function useAgain() {
  const target = {};
  Error.captureStackTrace(target);
  return [
    JSON.stringify({ d: [4] }),
    typeof Date.now(),
    Number.parseFloat("2.5x"),
    typeof process.hrtime(),
    typeof process.cwd(),
    typeof process.uptime(),
    typeof performance.now(),
    new Date(5).getTime(),
    new Date(0).toISOString(),
    typeof new Date(5).toString(),
    new Date(0).toLocaleDateString("en-US", { timeZone: "UTC" }),
    typeof target.stack,
    structuredClone({ e: 5 }).e,
    Date.parse("1970-01-01T00:00:01Z"),
    typeof JSON.parse,
    new TextEncoder().encode("abc").length,
    new Intl.NumberFormat("en").format(7),
  ];
}
for (let round = 0; round < 3; round++) console.log(useAgain().join(" | "), seen.length);
console.log(JSON.stringify === originals.stringify, Date.now === originals.now, TextEncoder === OriginalTextEncoder, Intl.NumberFormat === OriginalNumberFormat);
