// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Optional fields restored after extra properties.
import { run } from "./untyped.js";
run();

// FILE: shapes.ts
export class Inner {
  value = 1;
}
export class Other {
  name = "other";
}
export class Options {
  declare host?: string;
  declare port?: number;
  declare secure?: boolean;
  declare path?: string | null;
  declare inner?: Inner;
  declare whatever?: unknown;
  declare big?: bigint;
  declare mode?: "a" | "b";
  declare either?: number | string;
  declare mark?: symbol;
  always = 1;
  fill(round: number): void {
    this.host = "localhost";
    this.port = round;
    this.secure = true;
    this.path = "/";
    this.inner = new Inner();
    this.whatever = round;
    this.big = 1n;
    this.mode = "a";
    this.either = round;
    this.mark = Symbol.iterator;
  }
  describe(): string {
    return [this.host, this.port, this.secure, this.path, this.inner === undefined ? "none" : this.inner.value, String(this.whatever), this.big, this.mode, this.either, String(this.mark)].join("|");
  }
}
export type Settings = { id: number; host?: string; port?: number; secure?: boolean; inner?: Inner };
export function makeSettings(id: number): Settings {
  return { id };
}
export function fillSettings(settings: Settings, round: number): void {
  settings.host = "localhost";
  settings.port = round;
  settings.secure = false;
  settings.inner = new Inner();
}
export function describeSettings(settings: Settings): string {
  return [settings.id, settings.host, settings.port, settings.secure, settings.inner === undefined ? "none" : settings.inner.value].join("|");
}

// FILE: untyped.js
import { Options, Inner, Other, makeSettings, fillSettings, describeSettings } from "./shapes.ts";

function storeAll(o, v) {
  o.host = v.host;
  o.port = v.port;
  o.secure = v.secure;
  o.path = v.path;
  o.inner = v.inner;
  o.whatever = v.whatever;
  o.big = v.big;
  o.mode = v.mode;
  o.either = v.either;
  o.mark = v.mark;
}
function storeSome(o, v) {
  o.host = v.host;
  o.port = v.port;
  o.secure = v.secure;
  o.inner = v.inner;
}
function storeUnderKeys(o, v) {
  for (const key in v) o[key] = v[key];
}
function attempt(f) {
  try {
    f();
    return "";
  } catch (error) {
    return " threw " + error.constructor.name;
  }
}
const show = o => JSON.stringify(o, (key, value) => (typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? String(value) : value)) + " " + Object.keys(o).join();

const fitting = round => [
  { host: "h" + round, port: round + 0.5, secure: false, path: null, inner: new Inner(), whatever: { round }, big: 5n, mode: "b", either: "text", mark: Symbol.hasInstance },
  { host: "", port: -0, secure: true, path: "p", inner: new Inner(), whatever: undefined, big: 2n ** 70n, mode: "a", either: 2 ** 40, mark: Symbol.iterator },
  { host: "x".repeat(round), port: 2 ** 31, secure: false, path: "", inner: new Inner(), whatever: null, big: 0n, mode: "b", either: NaN, mark: Symbol.for("m") },
  { host: undefined, port: undefined, secure: undefined, path: undefined, inner: undefined, whatever: undefined, big: undefined, mode: undefined, either: undefined, mark: undefined },
];

const states = {
  bare: () => {},
  tagged: (o, round) => { o.tag = round; },
  taggedUnderAKey: (o, round) => { o[["t", "ag"].join("")] = round; },
  twoTags: (o, round) => { o.tag = round; o.more = round; },
};
const after = {
  nothing: () => {},
  frozen: o => { Object.freeze(o); },
  sealed: o => { Object.seal(o); },
  notExtensible: o => { Object.preventExtensions(o); },
  hostDeleted: o => { delete o.host; },
  portReadOnly: o => { Object.defineProperty(o, "port", { writable: false }); },
};

export function run() {
  for (const state in states) {
    for (const then in after) {
      for (const [how, store] of [["by name", storeAll], ["under keys", storeUnderKeys]]) {
        const said = new Set();
        for (let round = 0; round < 12; round++) {
          const o = new Options();
          states[state](o, 1);
          o.fill(1);
          after[then](o);
          let line = "";
          for (const values of fitting(3)) {
            line += attempt(() => store(o, values)) + " " + o.describe() + " " + show(o) + " ;";
          }
          said.add(line);
        }
        console.log(state, then, how, said.size, [...said][0]);
      }
    }
  }
  for (const state in states) {
    const said = new Set();
    for (let round = 0; round < 12; round++) {
      const o = new Options();
      states[state](o, 1);
      let line = "";
      for (const values of fitting(2)) {
        line += attempt(() => storeAll(o, values)) + " " + o.describe() + " " + show(o) + " ;";
      }
      said.add(line);
    }
    console.log(state, "never filled", said.size, [...said][0]);
  }
  for (const state in states) {
    const said = new Set();
    for (let round = 0; round < 12; round++) {
      const o = makeSettings(1);
      states[state](o, 1);
      fillSettings(o, 1);
      let line = "";
      for (const values of fitting(2)) {
        line += attempt(() => storeSome(o, values)) + " " + describeSettings(o) + " " + show(o) + " ;";
      }
      said.add(line);
    }
    console.log(state, "a record", said.size, [...said][0]);
  }
  const kept = [];
  for (let i = 0; i < 300; i++) {
    const o = new Options();
    o.tag = i;
    o.fill(i);
    kept.push(o);
  }
  for (let round = 0; round < 40; round++) {
    for (const o of kept) storeAll(o, { host: "h" + round, port: round, secure: round % 2 === 0, path: "/" + round, inner: new Inner(), whatever: [round], big: BigInt(round), mode: "a", either: "e" + round, mark: Symbol.iterator });
  }
  console.log("kept", new Set(kept.map(o => o.describe())).size, kept[299].describe(), kept[0].whatever[0], kept[150].tag);
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
