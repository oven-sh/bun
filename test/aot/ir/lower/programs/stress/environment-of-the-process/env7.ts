// RUN: lower
// OPTIONS: builtin-modules

// The environment of the process, one probe of many. It prints what plain Bun prints.
const e: any = (globalThis as any)[process.argv[3] ?? "process"].env;
function getterFor(key: string, unread: object): () => unknown {
  let lastRaw: unknown = unread;
  let lastParsed: unknown;
  return () => {
    const raw = e[key];
    if (raw !== lastRaw) {
      lastParsed = raw === undefined ? 0 : raw.length;
      lastRaw = raw;
    }
    return lastParsed;
  };
}
const names = ["HOME", "PATH", "NOT_THERE_AT_ALL", "USER", "TERM", "ALSO_MISSING", "LANG", "SHELL"];
const getters = names.map(name => getterFor(name, names));
const rounds = Number(process.argv[2] ?? 200000);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += getters[i & 7]() as number;
console.log(sum > 0, rounds);

// GENERATED: getterFor
// CHECK-LABEL: function {{*}}name="getterFor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|object site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewObject layout=[[L_5]]
// CHECK-NEXT: PutEnvironmentField v2, v1 layout=[[L_5]]
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: PutEnvironmentField v2, v4 layout=[[L_5]] field=1
// CHECK-NEXT: v6 = NewClosure v2, v0 function=[[f_6]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
