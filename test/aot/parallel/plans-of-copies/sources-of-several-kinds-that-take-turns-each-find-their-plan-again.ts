// Records of another declared type with names of their own, records out of JSON, and a second spread onto what the first has given names: sixteen kinds of each take turns at one literal.
// Each kind is copied the long way when it comes first, and then finds its plan again however many others came between.
// COUNTER: CopiesNotRepeated <= 48
// COUNTER: AssignmentPlansMade <= 48
interface Sheet { f0?: number; f1?: number; f2?: number; f3?: number; f4?: number; f5?: number; f6?: number; f7?: number; f8?: number; f9?: number; f10?: number; f11?: number; f12?: number; f13?: number; f14?: number; f15?: number; f16?: number; f17?: number; f18?: number; f19?: number; f20?: number; f21?: number; f22?: number; f23?: number; f24?: number; f25?: number; f26?: number; f27?: number; f28?: number; f29?: number; f30?: number; f31?: number; f32?: number; f33?: number; f34?: number; f35?: number; f36?: number; f37?: number; f38?: number; f39?: number; f40?: number; f41?: number; f42?: number; f43?: number; f44?: number; f45?: number; f46?: number; f47?: number; f48?: number; f49?: number; f50?: number; f51?: number; f52?: number; f53?: number; f54?: number; f55?: number; f56?: number; f57?: number; f58?: number; f59?: number; f60?: number; f61?: number; f62?: number; f63?: number; tick?: number }
interface Other { f0?: number; f1?: number; f2?: number; f3?: number; f4?: number; f5?: number; f6?: number; f7?: number; f8?: number; f9?: number; f10?: number; f11?: number; f12?: number; f13?: number; f14?: number; f15?: number; f16?: number; f17?: number; f18?: number; f19?: number; f20?: number; f21?: number; f22?: number; f23?: number; g0?: number; g1?: number; g2?: number; g3?: number; g4?: number; g5?: number; g6?: number; g7?: number; }
function next(s: Sheet, t: number): Sheet { return { ...s, tick: t }; }
function both(s: Sheet, o: Sheet, t: number): Sheet { return { ...s, ...o, tick: t }; }
(globalThis as any).kept = [next, both];
const K = 16;
const other = (): Other => ({ f0: 1, f1: 2, f2: 3, g0: 4, g1: 5 });
const compiled: Sheet[] = [], parsed: Sheet[] = [];
for (let i = 0; i < K; i++) {
  const record: any = other(); record["own" + i] = i; record.shared = "s"; compiled.push(record);
  parsed.push(JSON.parse(`{"f0":1,"f5":2,"parsed${i}":${i},"last":[${i}]}`));
}
let sum = 0, said = "";
for (let t = 0; t < 1600; t++) {
  const i = t % K, a: any = next(compiled[i], t), b: any = next(parsed[i], t), c: any = both(compiled[i], parsed[(i + 5) % K], t);
  sum += a.f0 + a.g1 + a["own" + i] + a.tick + b.f5 + b["parsed" + i] + b.last[0] + c.f0 + c.g0 + c["own" + i] + c["parsed" + (i + 5) % K] + c.tick;
  if (t % 397 === 0) said += [a, b, c].map(o => Object.keys(o).join()).join(" | ") + "\n";
}
console.log(sum);
console.log(said);
export {};
