// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 7
// CHECK-LABEL: function {{*}}name="say"
// CHECK-LABEL: function {{*}}name="load"
// CHECK-LABEL: function {{*}}name="readsWhatWasSetLater"
// CHECK-LABEL: function {{*}}name="readsTheCopy"

// FILE: main.ts
// The namespace object of a module is kept in a module variable to which nothing else is stored, and all that is ever done with what the variable holds is to read members by constant names. An export that nobody calls, names or reads is not in the program.
import { callHook as call0 } from "./aConstant.ts";
import { callHook as call1 } from "./setLater.ts";
import { callHook as call2 } from "./copiedToAnother.ts";
import { callHook as call3 } from "./importedAndKept.ts";
import { callHook as call4 } from "./readInAnotherModule.ts";
import { keptForOthers } from "./keeper.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
const aConstant = require("./aConstant.ts") as typeof import("./aConstant.ts");
function readsTheConstant(): number { return aConstant.unrelated(); }
let setLater: typeof import("./setLater.ts") | undefined;
function load(): void { setLater = require("./setLater.ts"); }
function readsWhatWasSetLater(): number { return setLater ? setLater.unrelated() : -1; }
const first = require("./copiedToAnother.ts") as typeof import("./copiedToAnother.ts");
const second = first;
function readsTheCopy(): number { const { unrelated } = second; return unrelated(); }
let imported: typeof import("./importedAndKept.ts") | undefined;
async function all(): Promise<void> {
    say("aConstant", readsTheConstant(), call0());
    say("setLater, before", readsWhatWasSetLater()); load(); say("setLater", readsWhatWasSetLater(), call1());
    say("copiedToAnother", readsTheCopy(), first === second, call2());
    imported = await import("./importedAndKept.ts"); say("importedAndKept", imported.unrelated(), call3());
    say("readInAnotherModule", keptForOthers.unrelated(), call4());
}
all().then(() => console.log(lines.join("\n")), error => console.log(lines.join("\n") + "\nfailed: " + error));

// FILE: aConstant.ts
let hookOfAConstant: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfAConstant = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfAConstant(); return t; }
export function unrelated(): number { return 0; }

// FILE: copiedToAnother.ts
let hookOfCopiedToAnother: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfCopiedToAnother = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfCopiedToAnother(); return t; }
export function unrelated(): number { return 2; }

// FILE: importedAndKept.ts
let hookOfImportedAndKept: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfImportedAndKept = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfImportedAndKept(); return t; }
export function unrelated(): number { return 3; }

// FILE: keeper.ts
export const keptForOthers = require("./readInAnotherModule.ts") as typeof import("./readInAnotherModule.ts");

// FILE: readInAnotherModule.ts
let hookOfReadInAnotherModule: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfReadInAnotherModule = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfReadInAnotherModule(); return t; }
export function unrelated(): number { return 4; }

// FILE: setLater.ts
let hookOfSetLater: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfSetLater = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfSetLater(); return t; }
export function unrelated(): number { return 1; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
