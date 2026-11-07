// RUN: lower
// OPTIONS: builtin-modules

// A generic patch by pick carries members the type forgot.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Settings {
  volume = 5;
  speed = 1.5;
  theme = "dark";
  loud(): boolean {
    return this.volume > 7;
  }
  faster(): number {
    return this.speed * 2;
  }
  banner(): string {
    return this.theme.toUpperCase();
  }
}

function patch<T, K extends keyof T>(target: T, part: Pick<T, K>): void {
  for (const key in part) target[key] = part[key];
}

function report(title: string, s: Settings): void {
  console.log(title + ": " + typeof s.volume + " " + show(s.volume) + ", " + typeof s.speed + " " + show(s.speed) + ", " + typeof s.theme + " " + show(s.theme) + ", keys " + Object.keys(s).join() + ", " + JSON.stringify(s));
  attempt("  loud", () => s.loud());
  attempt("  faster", () => s.faster());
  attempt("  banner", () => s.banner());
}

const s = new Settings();
let total = 0;
for (let i = 0; i < 2000; i++) {
  patch(s, { volume: i % 11 });
  patch(s, { speed: i / 8, theme: "t" + (i % 3) });
  total += (s.loud() ? 1 : 0) + s.faster() + s.banner().length;
}
console.log("2000 honest patches: " + total);
report("honest", s);

const form = { volume: 9, speed: "fast", theme: 3 };
const volumeOnly: { volume: number } = form;
patch(s, volumeOnly);
report("a patch of the volume brings a speed and a theme along", s);

const t = new Settings();
const withAMethod = { theme: "light", loud: "very", banner: 12 };
const themeOnly: { theme: string } = withAMethod;
patch(t, themeOnly);
report("a patch of the theme brings own members over two methods", t);

const u = new Settings();
const unknownMember = { speed: 2, depth: 4 };
const speedOnly: { speed: number } = unknownMember;
patch(u, speedOnly);
report("a patch of the speed brings a member the class never had", u);
report("a fresh instance", new Settings());

export {};

// GENERATED: patch Settings loud faster banner
// CHECK-LABEL: function {{*}}name="patch"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ForInOpen v1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = ForInStep v2, v1
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Convert v6 declared={type=undefined|null|string site=[[w_3]]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = ElemGet v1, v8
// CHECK-NEXT: ElemSet v0, v8, v9
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Settings"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="loud"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]] site=[[w_6]]} results=[{type=boolean site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="volume"
// CHECK-NEXT: v2 = Integer integer=7
// CHECK-NEXT: v3 = Greater v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_7]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="faster"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]] site=[[w_8]]} results=[{type=number site=[[w_9]]}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="speed"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="banner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]] site=[[w_10]]} results=[{type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="theme"
// CHECK-NEXT: v2 = PropGet v1 key="toUpperCase"
// CHECK-NEXT: v3 = Call v2, v1 calleeKey="toUpperCase" calleeName="this.theme.toUpperCase"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
