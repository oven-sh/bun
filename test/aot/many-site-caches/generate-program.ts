export const functionCount = 1_700;
const readsInFunction = 500;
const storesInFunction = 50;
const callsInFunction = 50;
export const sitesInFunction = readsInFunction + storesInFunction + callsInFunction;

export function generateProgram() {
  const lines: string[] = [];
  for (let f = 0; f < functionCount; f++) {
    const parts: string[] = [];
    for (let r = 0; r < readsInFunction; r++) parts.push(`o.p${(f + r) % 12}`);
    const stores: string[] = [];
    for (let s = 0; s < storesInFunction; s++) stores.push(`o.s${(f + s) % 5} = ${f + s};`);
    for (let c = 0; c < callsInFunction; c++) parts.push(`o.m${(f + c) % 3}(${c})`);
    lines.push(`function f${f}(o) { ${stores.join(" ")} return [${parts.join(", ")}]; }`);
  }
  lines.push(`const all = [${Array.from({ length: functionCount }, (_, f) => `f${f}`).join(", ")}];`);
  lines.push(`
function methods(scale) {
  return { m0(x) { return x * scale; }, m1(x) { return x + scale; }, m2(x) { return this.p0 + x - scale; } };
}
function own(first) {
  const o = Object.create(methods(2));
  for (let i = 0; i < 12; i++) o["p" + ((i + first) % 12)] = i * 3 + first;
  for (let i = 0; i < 5; i++) o["s" + i] = 0;
  return o;
}
function inherited(first) {
  const parent = own(first);
  parent.m1 = x => x - 7;
  return Object.create(parent);
}
function sparse() {
  const o = Object.create(methods(5));
  o.p0 = 1;
  o.p7 = "seven";
  return o;
}
function digest(values, o) {
  let text = 0;
  for (const value of values) text = (text * 31 + (typeof value === "number" && value === value ? value : String(value).length)) % 1000003;
  return text + ":" + [o.s0, o.s1, o.s2, o.s3, o.s4].join(",") + ":" + Object.keys(o).length;
}
const chosen = [0, 1, 2, ${Math.floor(functionCount / 2)}, ${functionCount - 3}, ${functionCount - 2}, ${functionCount - 1}];
for (const index of chosen) {
  const f = all[index];
  const makers = [() => own(0), () => own(5), () => inherited(3), sparse];
  for (const make of makers) {
    for (let turn = 0; turn < 3; turn++) {
      const o = make();
      console.log(index, turn, digest(f(o), o));
    }
  }
  const o = own(1);
  console.log(index, "before", digest(f(o), o));
  Object.getPrototypeOf(o).m0 = x => x + 1000;
  delete o.p3;
  console.log(index, "after", digest(f(o), o));
  Object.defineProperty(o, "p4", { get() { return 44; }, configurable: true });
  console.log(index, "getter", digest(f(o), o));
  for (const wrong of [null, undefined]) {
    try {
      f(wrong);
    } catch (error) {
      console.log(index, String(wrong), error instanceof TypeError);
    }
  }
  console.log(index, "number", f(Object.assign(Object.create(methods(1)), { p0: 4 })).length);
}
`);
  return lines.join("\n") + "\n";
}

if (import.meta.main) await Bun.write(process.argv[2], generateProgram());
