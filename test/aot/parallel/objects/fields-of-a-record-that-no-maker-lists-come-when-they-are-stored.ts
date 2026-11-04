// A record's optional fields that no literal lists: absent until stored, then in the order of the stores; through spreads, deletes, JSON and 2,000 objects.
interface Message { text: string; id: number; isMeta?: boolean; origin?: string; extra?: object; note?: string; more?: number; never?: string }
function make(text: string, id: number): Message { return { text, id }; }
function makeWithOrigin(text: string, id: number, origin: string): Message { return { text, id, origin }; }
function mark(message: Message) { message.isMeta = true; message.note = "noted"; }
function copy(message: Message): Message { return { ...message, more: 4 }; }
const brief = (v: any): string => v === undefined ? "undefined" : typeof v === "object" && v !== null ? "{" + Object.keys(v).join("+") + "}" : String(v);
const show = (m: Message) => Object.keys(m).join() + " | " + [m.text, m.id, m.isMeta, m.origin, m.extra, m.note, m.more, m.never].map(brief).join();
const other = make("other", 0); (other as any).later = 1;
const plain = make("plain", 1), from = makeWithOrigin("from", 2, "here"), marked = make("marked", 3);
mark(marked); marked.extra = { a: 1 };
const said = [show(other), show(plain), show(from), show(marked), show(copy(marked)), show(copy(plain)), show({ ...from, ...marked })];
said.push(String("isMeta" in plain) + ("isMeta" in marked) + Object.hasOwn(plain, "note") + Object.hasOwn(marked, "note") + JSON.stringify(marked) + JSON.stringify(plain));
delete marked.note; said.push(show(marked)); marked.note = "again"; said.push(show(marked));
let sum = 0; const all: Message[] = [];
for (let i = 0; i < 2000; i++) { const m = i % 3 ? make("m" + i, i) : makeWithOrigin("o" + i, i, "x"); if (i % 5 === 0) mark(m); if (i % 7 === 0) m.more = i; all.push(i % 11 ? m : copy(m)); }
for (const m of all) sum += m.id + (m.isMeta ? 1 : 0) + (m.more ?? 2) + (m.note ? m.note.length : 0) + (m.origin ? 3 : 0) + Object.keys(m).length;
said.push(String(sum));
console.log(said.join("\n"));
