// An ES module whose exported setter nobody calls and nobody names is taken by require(), and its namespace object gets away, in one way a file: the setter is found all the same, and what it stores is called.
import { callHook as call0 } from "./aComputedKey.ts";
import { callHook as call1 } from "./handedOn.ts";
import { callHook as call2 } from "./itsKeys.ts";
import { callHook as call3 } from "./aSpread.ts";
import { callHook as call4 } from "./assertedToBeARecord.ts";
import { callHook as call5 } from "./assertedAndHandedOn.ts";
import { callHook as call6 } from "./stored.ts";
import { callHook as call7 } from "./returned.ts";
import { callHook as call8 } from "./readByName.ts";
import { callHook as call9 } from "./readByNameInAPattern.ts";
import { callHook as call10 } from "./aRestInAPattern.ts";
import { callHook as call11 } from "./byUntypedCode.ts";
import { callHook as call12 } from "./exportedAgainByUntypedCode.ts";
import { storesFromUntypedCode, again } from "./untyped.js";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
function seven(): number { return 7; }
const hookWord: string = ["Hook"][lines.length];
const held: any[] = [];
function takes(ns: any): void { ns["set" + hookWord](seven); }
function returns(): any { return require("./returned.ts"); }
{ say("aComputedKey, before", call0()); require("./aComputedKey.ts")["set" + hookWord](seven); say("aComputedKey", call0()); }
{ say("handedOn, before", call1()); takes(require("./handedOn.ts")); say("handedOn", call1()); }
{ say("itsKeys, before", call2()); { const ns = require("./itsKeys.ts"); for (const key of Object.keys(ns)) if (key.startsWith("set")) ns[key](seven); } say("itsKeys", call2()); }
{ say("aSpread, before", call3()); { const copy = { ...require("./aSpread.ts") }; copy.setHook(seven); } say("aSpread", call3()); }
{ say("assertedToBeARecord, before", call4()); (require("./assertedToBeARecord.ts") as { setHook(fn: () => number): void }).setHook(seven); say("assertedToBeARecord", call4()); }
{ say("assertedAndHandedOn, before", call5()); takes(require("./assertedAndHandedOn.ts") as typeof import("./assertedAndHandedOn.ts")); say("assertedAndHandedOn", call5()); }
{ say("stored, before", call6()); { held.push(require("./stored.ts")); held[held.length - 1].setHook(seven); } say("stored", call6()); }
{ say("returned, before", call7()); returns()["set" + hookWord](seven); say("returned", call7()); }
{ say("readByName, before", call8()); require("./readByName.ts").setHook(seven); say("readByName", call8()); }
{ say("readByNameInAPattern, before", call9()); { const { setHook } = require("./readByNameInAPattern.ts") as typeof import("./readByNameInAPattern.ts"); setHook(seven); } say("readByNameInAPattern", call9()); }
{ say("aRestInAPattern, before", call10()); { const { unrelated, ...rest } = require("./aRestInAPattern.ts"); rest.setHook(seven); say("unrelated", unrelated()); } say("aRestInAPattern", call10()); }
{ say("byUntypedCode, before", call11()); storesFromUntypedCode(seven); say("byUntypedCode", call11()); }
{ say("exportedAgainByUntypedCode, before", call12()); (again as any)["set" + hookWord](seven); say("exportedAgainByUntypedCode", call12()); }
console.log(lines.join("\n"));
