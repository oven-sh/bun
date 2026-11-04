// RUN: lower
// OPTIONS: builtin-modules

// A const type parameter gives literal types to an object that is stored to.
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

function exact<const T>(value: T): T {
  return value;
}

const config = exact({ retries: 3, mode: "fast", nested: { depth: 1 }, list: [1, 2] });
const open: { retries: number; mode: string; nested: { depth: number } } = config;

function retriesName(): string {
  switch (config.retries) {
    case 3:
      return "three";
  }
}

function modeName(): string {
  if (config.mode === "fast") return "fast";
  const never: never = config.mode;
  return "never: " + show(never);
}

function report(title: string): void {
  console.log(title + ": " + JSON.stringify(config));
  attempt("  retries", () => [config.retries, config.retries + 1, config.retries === 3, retriesName()]);
  attempt("  mode", () => [config.mode, config.mode.length, config.mode === "fast", modeName()]);
  attempt("  depth", () => [config.nested.depth, config.nested.depth === 1, config.nested.depth * 2]);
  attempt("  list", () => [config.list[0], config.list[1], config.list.length, config.list.length === 2, config.list[0] === 1]);
}

report("before");
open.retries = 5;
report("retries = 5");
open.mode = "slow";
report("mode = 'slow'");
open.nested.depth = 0.5;
report("depth = 0.5");
open.nested = { depth: 9 };
report("another nested object");

const source = [1, 2];
const listed = exact({ list: source });
source.push(3);
source[0] = 0.5;
attempt("a list that has another name", () => [listed.list, listed.list.length, listed.list[0] + 1]);

const pair = exact([1, "a"]);
attempt("a list literal is a readonly tuple of literals", () => [pair[0], pair[1], pair.length, pair[0] === 1, pair[1] === "a"]);
const asList: readonly (number | string)[] = pair;
attempt("seen as a list", () => [asList.length, asList[5], typeof asList[5]]);

const flags = exact({ on: true, off: false, nothing: null, missing: undefined });
const openFlags: { on: boolean; off: boolean } = flags;
openFlags.on = false;
openFlags.off = true;
attempt("booleans", () => [flags.on, flags.off, flags.on ? "on" : "not on", flags.off ? "off is true" : "off", flags.on === true, flags.nothing, flags.missing]);

const zero = exact({ value: 0 });
const openZero: { value: number } = zero;
openZero.value = -0;
attempt("zero holds minus zero", () => [zero.value, Object.is(zero.value, 0), zero.value === 0, 1 / zero.value]);

export {};

// GENERATED: attempt retriesName
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = Call v1 calleeName="run"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="show"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string="threw "
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="Error" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v13 = InstanceOf v8, v12
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: Branch v14 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: v16 = PropGet v8 key="constructor"
// CHECK-NEXT: v17 = PropGet v16 key="name"
// CHECK-NEXT: Jump -> next b5(v17)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v20 = Call v19, -, v8 calleeName="show"
// CHECK-NEXT: Jump -> next b5(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: v22 = Add v9, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v23)
// CHECK-NEXT: b6(v24: undefined|null|string):
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = String string=" -> "
// CHECK-NEXT: v31 = Add v0, v30
// CHECK-NEXT: v32 = Add v31, v24
// CHECK-NEXT: v33 = Call v29, v27, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="retriesName"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="config"
// CHECK-NEXT: v2 = PropGet v1 key="retries"
// CHECK-NEXT: Switch v2 cases=[3] -> case b1(), otherwise b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="three"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
