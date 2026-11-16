// Records of a declared type that bear names of their own beside it are spread into a literal of that type: the fields go as words and the names as a copy, whatever names they are: no plan is made for any of them.
// COUNTER: AssignmentPlansCreated = 0
interface Sheet { f0?: number; f1?: number; f2?: number; f3?: number; f4?: number; f5?: number; f6?: number; f7?: number; f8?: number; f9?: number; f10?: number; f11?: number; f12?: number; f13?: number; f14?: number; f15?: number; f16?: number; f17?: number; f18?: number; f19?: number; f20?: number; f21?: number; f22?: number; f23?: number; f24?: number; f25?: number; f26?: number; f27?: number; f28?: number; f29?: number; f30?: number; f31?: number; f32?: number; f33?: number; f34?: number; f35?: number; f36?: number; f37?: number; f38?: number; f39?: number; f40?: number; f41?: number; f42?: number; f43?: number; f44?: number; f45?: number; f46?: number; f47?: number; f48?: number; f49?: number; f50?: number; f51?: number; f52?: number; f53?: number; f54?: number; f55?: number; f56?: number; f57?: number; f58?: number; f59?: number; f60?: number; f61?: number; f62?: number; f63?: number; tick?: number }
interface Card { id?: number; label?: string; tick?: number }
const sheet = (): Sheet => ({ f0: 1, f3: 4, f9: 10, f17: 18, f31: 32, f47: 48, f63: 64 });
const card = (): Card => ({ id: 1, label: "one" });
function nextSheet(s: Sheet, t: number): Sheet { return { ...s, tick: t }; }
function nextCard(c: Card, t: number): Card { return { ...c, tick: t }; }
(globalThis as any).kept = [nextSheet, nextCard];
const dressed = (record: any, names: any) => { for (const name of Object.keys(names)) record[name] = names[name]; return record; };
const sheets: Sheet[] = [], cards: Card[] = [];
for (let i = 0; i < 40; i++) {
  const names = JSON.parse(`{"own${i}":${i},"shared":"s","last${i % 7}":[${i}]}`);
  sheets.push(dressed(sheet(), names));
  cards.push(dressed(card(), names));
}
let sum = 0, keys = "";
for (let t = 0; t < 400; t++) {
  const s: any = nextSheet(sheets[t % 40], t), c: any = nextCard(cards[t % 40], t);
  sum += s.f63 + s.tick + s["own" + (t % 40)] + c.id + c.tick + c["last" + (t % 40 % 7)][0];
  if (t % 97 === 0) keys += Object.keys(s).join() + "|" + Object.keys(c).join() + "\n";
  s.shared = c.shared = "changed";
}
console.log(sum, sheets.every((s: any) => s.shared === "s" && s.tick === undefined), cards.every((c: any) => c.shared === "s"));
console.log(keys);
export {};
