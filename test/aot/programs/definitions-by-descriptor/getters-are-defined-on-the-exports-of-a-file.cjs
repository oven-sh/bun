// Object.defineProperty gives the exports of a CommonJS file getters, as compilers to CommonJS write them, with every set of attributes, and the program then asks what it got.
let calls = 0;
function first() { calls++; return "first"; }
Object.defineProperty(exports, "first", { enumerable: true, get: first });
Object.defineProperty(exports, "open", { enumerable: true, configurable: true, get: function () { return this === exports ? "open" : "another receiver"; } });
Object.defineProperty(exports, "hidden", { get: () => "hidden" });
Object.defineProperty(exports, "hiddenAndOpen", { configurable: true, get: () => "hidden and open" });
Object.defineProperty(exports, "withSetter", { enumerable: true, get: () => kept, set: value => { kept = value + 1; } });
Object.defineProperty(exports, "setterAlone", { enumerable: true, set: value => { kept = value + 2; } });
Object.defineProperty(exports, "getterLeftOut", { enumerable: true, get: undefined });
Object.defineProperty(exports, "__esModule", { value: true });
var kept = 1;

const attempt = run => { try { return String(run()); } catch (error) { return error.name + ": " + error.message; } };
const describe = name => {
  const found = Object.getOwnPropertyDescriptor(exports, name);
  return found ? Object.keys(found).map(key => key + "=" + (typeof found[key] === "function" ? "function" : String(found[key]))).join() : "nothing";
};
for (const name of Reflect.ownKeys(exports)) console.log(name, describe(name), "|", attempt(() => exports[name]));
console.log(Object.keys(exports).join(), "|", JSON.stringify(exports), "|", calls);
console.log(Object.getOwnPropertyDescriptor(exports, "first").get === first, Object.create(exports).open, Reflect.get(exports, "open", {}));

console.log(attempt(() => { "use strict"; exports.first = 1; return "stored"; }), attempt(() => { exports.withSetter = 5; return exports.withSetter; }), attempt(() => { exports.setterAlone = 5; return kept; }));
console.log(attempt(() => delete exports.first), attempt(() => delete exports.open), attempt(() => delete exports.hiddenAndOpen), Reflect.ownKeys(exports).join());
console.log(attempt(() => { Object.defineProperty(exports, "first", { enumerable: true, get: first }); return "the same again"; }));
console.log(attempt(() => { Object.defineProperty(exports, "first", { enumerable: true, get: () => 2 }); return "another getter"; }));
console.log(attempt(() => { Object.defineProperty(exports, "first", { value: 2 }); return "a value"; }));
console.log(attempt(() => { Object.defineProperty(exports, "open", { enumerable: true, get: () => "defined again" }); return exports.open + " " + describe("open"); }));
console.log(attempt(() => { Object.defineProperty(exports, "late", { enumerable: true, get: () => "late" }); return exports.late + " " + Object.keys(exports).join(); }));
console.log(attempt(() => { Object.freeze(exports); Object.defineProperty(exports, "tooLate", { get: () => 1 }); return "defined"; }), Object.isFrozen(exports), exports.first, calls);
