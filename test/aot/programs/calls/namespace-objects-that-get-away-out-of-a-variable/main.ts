// The namespace object of a module whose exported setter nobody calls and nobody names is kept in a module variable and gets away from there, in one way a file: the setter is found all the same, and what it stores is called.
import { callHook as call0 } from "./handedOn.ts";
import { callHook as call1 } from "./aComputedKey.ts";
import { callHook as call2 } from "./somethingElseIsStoredToo.ts";
import { callHook as call3 } from "./copiedAndHandedOn.ts";
import { callHook as call4 } from "./readByName.ts";
import { callHook as call5 } from "./capturedByAClosure.ts";
import { callHook as call6 } from "./twoNamespacesInOneVariable.ts";
import { callHook as call7 } from "./exportedAndTakenByAKey.ts";
import { callHook as call8 } from "./itsKeys.ts";
import { callHook as callOther } from "./theOtherOfTwo.ts";
import * as keeper from "./keeper.ts";
const lines: string[] = [];
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(String).join(" | ")); }
function seven(): number { return 7; }
const hookWord: string = ["Hook"][lines.length];
function takes(ns: any): void { ns["set" + hookWord](seven); }
const handedOn = require("./handedOn.ts");
const aComputedKey = require("./aComputedKey.ts");
let somethingElseIsStoredToo: any = require("./somethingElseIsStoredToo.ts");
const copiedFrom = require("./copiedAndHandedOn.ts"); const copiedTo = copiedFrom;
const readByName = require("./readByName.ts") as typeof import("./readByName.ts");
const capturedByAClosure = require("./capturedByAClosure.ts");
let twoNamespacesInOneVariable: any = require("./twoNamespacesInOneVariable.ts");
const itsKeys = require("./itsKeys.ts");
{ say("handedOn, before", call0()); takes(handedOn); say("handedOn", call0()); }
{ say("aComputedKey, before", call1()); aComputedKey["set" + hookWord](seven); say("aComputedKey", call1()); }
{ say("somethingElseIsStoredToo, before", call2()); { const before = somethingElseIsStoredToo; somethingElseIsStoredToo = { unrelated() { return -1; } }; say("the other", somethingElseIsStoredToo.unrelated()); somethingElseIsStoredToo = before; somethingElseIsStoredToo["set" + hookWord](seven); } say("somethingElseIsStoredToo", call2()); }
{ say("copiedAndHandedOn, before", call3()); takes(copiedTo); say("copiedAndHandedOn", call3()); }
{ say("readByName, before", call4()); readByName.setHook(seven); say("readByName", call4()); }
{ say("capturedByAClosure, before", call5()); (() => capturedByAClosure["set" + hookWord](seven))(); say("capturedByAClosure", call5()); }
{ say("twoNamespacesInOneVariable, before", call6()); { twoNamespacesInOneVariable["set" + hookWord](seven); twoNamespacesInOneVariable = require("./theOtherOfTwo.ts"); twoNamespacesInOneVariable["set" + hookWord](seven); say("theOtherOfTwo", callOther()); } say("twoNamespacesInOneVariable", call6()); }
{ say("exportedAndTakenByAKey, before", call7()); (keeper as any)["kept" + hookWord]["set" + hookWord](seven); say("exportedAndTakenByAKey", call7()); }
{ say("itsKeys, before", call8()); for (const key of Object.keys(itsKeys)) if (key.startsWith("set")) itsKeys[key](seven); say("itsKeys", call8()); }
console.log(lines.join("\n"));
