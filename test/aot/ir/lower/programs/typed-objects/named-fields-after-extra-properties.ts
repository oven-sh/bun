// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
import { run } from "./untyped.js";
run();

// FILE: shapes.ts
export class Options {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
}
export class Packed {
  declare host?: unknown;
  declare port?: unknown;
  declare path?: unknown;
  declare secure?: unknown;
}
export class Extended {
  declare host?: string;
  declare port?: number;
  declare path?: string;
  declare secure?: boolean;
  always = 1;
}
export type Settings = { id: number; host?: string; port?: number; path?: string; secure?: boolean };
export function makeSettings(id: number): Settings {
  return { id };
}
export function tagOptions(o: Options, tag: number): void {
  (o as any).tag = tag;
}
export function tagPacked(o: Packed, tag: number): void {
  (o as any).tag = tag;
}
export function tagSettings(o: Settings, tag: number): void {
  (o as any).tag = tag;
}
export class Wide {
  declare f0?: number;
  declare f1?: string;
  declare f2?: number;
  declare f3?: string;
  declare f4?: number;
  declare f5?: string;
  declare f6?: number;
  declare f7?: string;
  declare f8?: number;
  declare f9?: string;
  declare f10?: number;
  declare f11?: string;
  always = 1;
}
export function tagWide(o: Wide, tag: number): void {
  (o as any).tag = tag;
}

// FILE: untyped.js
import { Options, Packed, Extended, makeSettings, tagOptions, tagPacked, tagSettings, Wide, tagWide } from "./shapes.ts";

class Heir extends Extended {}
class HeirWithSetter extends Extended {
  set port(value) {
    this.seen = value;
  }
  get port() {
    return -1;
  }
}


function fillOptions(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillPacked(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillHeir(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillHeirWithSetter(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillSettings(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillTurns(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillChanging(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillBetween(o, port) { o.host = "localhost"; o.first = port; o.port = port; o.second = port; o.path = "/"; o.secure = false; }
function fillFrozen(o, port) { o.host = "localhost"; o.port = port; }
function fillTagged(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillTaggedPacked(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillTaggedSettings(o, port) { o.host = "localhost"; o.port = port; o.path = "/"; o.secure = false; }
function fillHalves(o, port) { o.host = "localhost"; o.port = port * 1.5; o.path = "/"; o.secure = port > 3; }
function fillApart(o, port) { o.host = "localhost"; if (port < 0) return; o.port = port; if (port < -1) return; o.path = "/"; if (port < -2) return; o.secure = false; }
function fillWide(o, n) { o.f0 = n; o.f1 = "a"; o.f2 = n; o.f3 = "b"; o.f4 = n; o.f5 = "c"; o.f6 = n; o.f7 = "d"; o.f8 = n; o.f9 = "e"; o.f10 = n; o.f11 = "f"; }
function fillWideBackwards(o, n) { o.f11 = "f"; o.f10 = n; o.f9 = "e"; o.f8 = n; o.f7 = "d"; o.f6 = n; o.f5 = "c"; o.f4 = n; o.f3 = "b"; o.f2 = n; o.f1 = "a"; o.f0 = n; }

function many(label, make, give, fill, rounds = 200) {
  const said = new Map();
  for (let i = 0; i < rounds; i++) {
    const o = make();
    give(o, i);
    fill(o, i);
    const keys = Object.keys(o).join() + " " + o.host + " " + typeof o.port + " " + o.path + " " + o.secure;
    said.set(keys, (said.get(keys) ?? 0) + 1);
  }
  console.log(label, [...said].map(([keys, count]) => count + " x " + keys).join(" || "));
}

export function run() {
  many("Options, one by name", () => new Options(), (o, i) => { o.tag = i; }, fillOptions);
  many("Options again, two by name", () => new Options(), (o, i) => { o.tag = i; o.more = i; }, fillOptions);
  many("Options again, none", () => new Options(), () => {}, fillOptions);
  many("Options again, one by name", () => new Options(), (o, i) => { o.tag = i; }, fillOptions);
  many("Packed, one by name", () => new Packed(), (o, i) => { o.tag = i; }, fillPacked);
  many("Packed again, none", () => new Packed(), () => {}, fillPacked);
  many("Heir, one by name", () => new Heir(), (o, i) => { o.tag = i; }, fillHeir);
  many("an heir with a setter, one by name", () => new HeirWithSetter(), (o, i) => { o.tag = i; }, fillHeirWithSetter);
  many("a record, one by name", () => makeSettings(1), (o, i) => { o.tag = i; }, fillSettings);
  many("in turns", () => new Options(), (o, i) => { if (i & 1) o.tag = i; if (i & 2) o.more = i; if (i & 4) o["key" + (i & 24)] = i; }, fillTurns);
  many("some fields there already", () => new Options(), (o, i) => { if (i % 3 === 0) o.path = "early"; o.tag = i; if (i % 5 === 0) o.secure = true; }, fillChanging);
  many("more between", () => new Options(), (o, i) => { o.tag = i; }, fillBetween);
  many("more between, packed", () => new Packed(), (o, i) => { o.tag = i; }, fillBetween);

  many("Options, tagged by typed code", () => new Options(), tagOptions, fillTagged);
  many("Options, tagged by typed code, and one more by name", () => new Options(), (o, i) => { tagOptions(o, i); o.more = i; }, fillTagged);
  many("Packed, tagged by typed code", () => new Packed(), tagPacked, fillTaggedPacked);
  many("a record, tagged by typed code", () => makeSettings(1), tagSettings, fillTaggedSettings);
  many("numbers that are no integers", () => new Options(), tagOptions, fillHalves);
  many("stores apart", () => new Options(), tagOptions, fillApart);
  many("stores apart, packed", () => new Packed(), tagPacked, fillApart);
  for (const [label, fill] of [["wide", fillWide], ["wide, backwards", fillWideBackwards]]) {
    const said = new Map();
    for (let i = 0; i < 200; i++) {
      const o = new Wide();
      if (i % 3) tagWide(o, i);
      if (i % 3 === 2) o["k" + (i & 3)] = i;
      fill(o, i);
      const text = Object.keys(o).join() + " " + (o.f0 + o.f2 + o.f4 + o.f6 + o.f8 + o.f10 === 6 * i) + o.f1 + o.f3 + o.f5 + o.f7 + o.f9 + o.f11;
      said.set(text, (said.get(text) ?? 0) + 1);
    }
    console.log(label, [...said].map(([text, count]) => count + " x " + text).join(" || "));
  }

  function storeAgain(o, port) { o.host = "other"; o.port = port + 1; o.path = "/x"; o.secure = true; }
  for (const [label, make, tag, fill] of [["Options", () => new Options(), tagOptions, fillTagged], ["Packed", () => new Packed(), tagPacked, fillTaggedPacked], ["a record", () => makeSettings(1), tagSettings, fillTaggedSettings]]) {
    const said = new Map();
    for (let i = 0; i < 120; i++) {
      const o = make();
      tag(o, i);
      fill(o, i);
      if (i >= 60 && i < 80) Object.freeze(o);
      if (i >= 80 && i < 100) Object.defineProperty(o, "path", { writable: false });
      let refused = "";
      try {
        storeAgain(o, i);
      } catch (error) {
        refused = error.constructor.name;
      }
      const text = Object.keys(o).join() + " " + o.host + " " + (o.port - i) + " " + o.path + " " + o.secure + " " + refused;
      said.set(text, (said.get(text) ?? 0) + 1);
    }
    console.log(label + ", stored to again", [...said].map(([text, count]) => count + " x " + text).join(" || "));
  }

  many("the prototype gets a setter in the middle", () => new Heir(), (o, i) => {
    o.tag = i;
    if (i === 120) Object.defineProperty(Heir.prototype, "path", { set(value) { this.seenPath = value; }, get() { return "inherited"; }, configurable: true });
  }, fillHeir);

  many("across collections", () => new Options(), (o, i) => {
    o["born" + (i >> 6)] = i;
    o.tag = i;
    if (typeof Bun !== "undefined" && i % 64 === 63) Bun.gc(true);
  }, fillOptions, 640);

  const refusals = [];
  for (let i = 0; i < 60; i++) {
    const o = new Options();
    o.tag = i;
    if (i >= 40) Object.preventExtensions(o);
    try {
      fillFrozen(o, i);
      refusals.push("stored");
    } catch (error) {
      refusals.push(error.constructor.name);
    }
  }
  console.log("not extensible from the fortieth on", refusals.slice(36, 44).join());
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="run"
// CHECK-NEXT: v2 = Call v1 calleeName="run"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
