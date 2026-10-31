// RUN: lower
// OPTIONS: builtin-modules

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

type Mode = "on" | "off";
type Level = 0 | 1 | 2;

class Switch {
  mode: Mode = "on";
  level: Level = 0;
  armed: boolean = true;
  big: 1n | 2n = 1n;
}

type Between = (s: Switch) => void;
const keep: Between = () => {};
const flip: Between = s => {
  s.mode = "off";
  s.level = 2;
  s.armed = false;
  s.big = 2n;
};

const costs = { on: 10, off: 20 };
const names = ["zero", "one", "two"];

function onlyOn(m: "on"): string {
  return m + "!";
}

function onlyZero(l: 0): number {
  return l + 100;
}

function word(m: Mode): string {
  switch (m) {
    case "on":
      return "lit";
    case "off":
      return "dark";
  }
}

const uses: [string, (s: Switch, between: Between) => unknown][] = [
  ["a string, read", (s, between) => (s.mode === "on" ? (between(s), s.mode) : "other")],
  ["a string, compared again", (s, between) => (s.mode === "on" ? (between(s), s.mode === "on") : "other")],
  ["a string, as a key", (s, between) => (s.mode === "on" ? (between(s), costs[s.mode]) : "other")],
  ["a string, handed on", (s, between) => (s.mode === "on" ? (between(s), onlyOn(s.mode)) : "other")],
  ["a string, switched on", (s, between) => (s.mode === "on" ? (between(s), word(s.mode)) : "other")],
  ["a string, in a template", (s, between) => (s.mode === "on" ? (between(s), `<${s.mode}>`) : "other")],
  ["a string, its length", (s, between) => (s.mode === "on" ? (between(s), s.mode.length) : "other")],
  ["a string, by exclusion", (s, between) => (s.mode !== "off" ? (between(s), s.mode) : "other")],
  ["a number, read", (s, between) => (s.level === 0 ? (between(s), s.level) : "other")],
  ["a number, plus one", (s, between) => (s.level === 0 ? (between(s), s.level + 1) : "other")],
  ["a number, as an index", (s, between) => (s.level === 0 ? (between(s), names[s.level]) : "other")],
  ["a number, handed on", (s, between) => (s.level === 0 ? (between(s), onlyZero(s.level)) : "other")],
  ["a number, tested", (s, between) => (s.level === 0 ? (between(s), s.level ? "truthy" : "falsy") : "other")],
  ["a number, falsy", (s, between) => (!s.level ? (between(s), s.level) : "other")],
  ["a number, by exclusion", (s, between) => (s.level !== 1 && s.level !== 2 ? (between(s), s.level) : "other")],
  ["a boolean, read", (s, between) => (s.armed ? (between(s), s.armed) : "other")],
  ["a boolean, tested", (s, between) => (s.armed ? (between(s), s.armed ? "yes" : "no") : "other")],
  ["a boolean, negated", (s, between) => (s.armed === true ? (between(s), !s.armed) : "other")],
  ["a bigint, read", (s, between) => (s.big === 1n ? (between(s), s.big) : "other")],
  ["a bigint, doubled", (s, between) => (s.big === 1n ? (between(s), s.big * 2n) : "other")],
];

class Owner {
  mode: Mode = "on";
  change(really: boolean): void {
    if (really) this.mode = "off";
  }
  inItsOwnField(really: boolean): unknown {
    if (this.mode === "on") {
      this.change(really);
      return [this.mode, costs[this.mode], onlyOn(this.mode)];
    }
    return "other";
  }
}

function inAnElement(modes: Mode[], really: boolean): unknown {
  const change = (): void => {
    if (really) modes[0] = "off";
  };
  if (modes[0] === "on") {
    change();
    return [modes[0], costs[modes[0]], onlyOn(modes[0])];
  }
  return "other";
}

function inACapturedVariable(really: boolean): unknown {
  let m: Mode = "on";
  const change = (): void => {
    if (really) m = "off";
  };
  if (m === "on") {
    change();
    return [m, costs[m], onlyOn(m)];
  }
  return "other";
}

function round(label: string, between: Between, really: boolean): void {
  for (const [name, use] of uses) attempt(label + " " + name, () => use(new Switch(), between));
  attempt(label + " in its own field", () => new Owner().inItsOwnField(really));
  attempt(label + " in an element", () => inAnElement(["on"], really));
  attempt(label + " in a captured variable", () => inACapturedVariable(really));
}

round("honest", keep, false);
let rounds = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) use(new Switch(), keep);
  new Owner().inItsOwnField(false);
  inAnElement(["on"], false);
  inACapturedVariable(false);
  rounds++;
}
console.log("honest rounds: " + rounds);
round("flipped", flip, true);
round("honest again", keep, false);

// GENERATED: onlyZero word Switch inItsOwnField flip
// CHECK-LABEL: function {{*}}name="onlyZero"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=0 site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: 0):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=100
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="word"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|"off"|"on" site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|"off"|"on"):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["on", "off"] -> case b2(| 0), case b4(| 0), otherwise b6()
// CHECK-NEXT: b2(v1):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = String string="lit"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = String string="dark"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Switch"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_6]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inItsOwnField"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_7]] site=[[w_8]]} parameters=[{type=boolean site=[[w_9]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_7]], v1: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="mode"
// CHECK-NEXT: v3 = String string="on"
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = PropGet v0 key="change"
// CHECK-NEXT: v6 = Call v5, v0, v1 calleeKey="change" calleeName="this.change"
// CHECK-NEXT: v7 = PropGet v0 key="mode"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="costs"
// CHECK-NEXT: v10 = PropGet v0 key="mode"
// CHECK-NEXT: v11 = ElemGet v9, v10
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v13 = PropGet v0 key="mode"
// CHECK-NEXT: v14 = Call v12, -, v13 calleeName="onlyOn"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v16 = NewArray v7, v11, v15 contents=anything
// CHECK-NEXT: Return v16
// CHECK-NEXT: b3():
// CHECK-NEXT: v17 = String string="other"
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="flip"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="off"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|"off"|"on" site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v0, v2 key="mode"
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Convert v4 declared={type=int[0, 2] site=[[w_16]]}
// CHECK-NEXT: PropSet v0, v5 key="level"
// CHECK-NEXT: v7 = Boolean
// CHECK-NEXT: v8 = Convert v7 declared={type=boolean site=[[w_17]]}
// CHECK-NEXT: PropSet v0, v8 key="armed"
// CHECK-NEXT: v10 = BigInt digits="2"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|bigint site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v0, v11 key="big"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
