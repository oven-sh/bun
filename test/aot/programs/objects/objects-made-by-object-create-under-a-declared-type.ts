// `const made: Answer = Object.create(above)`: the interface declares what the objects hold and what lies above them. Names that the type requires are never stored, names that it does not
// declare are stored through `any`, values of other types arrive, and the members above change: nothing throws because of a type.
interface Wire { sent: boolean; code: number }
interface Answer {
  wire: Wire; label: string; count: number; note?: string; never: string;
  readonly sent: boolean; status: number; tell(prefix: string): string;
}
const log: string[] = [];
const members = {
  get sent() { return this.wire.sent; },
  set status(code: number) { this.count++; this.wire.code = code; },
  get status() { return this.wire.code; },
  tell(prefix: string) { return prefix + this.label + (this.note ?? "") + String(this.never); },
} satisfies ThisType<Answer>;
class Server {
  answer: Answer;
  constructor() { this.answer = Object.create(members); }
  make(label: string, wire: Wire): Answer {
    const made: Answer = Object.create(this.answer);
    made.wire = wire; made.label = label; made.count = 0;
    return made;
  }
}
function use(answer: Answer, turn: number) {
  answer.status = 200 + turn;
  return answer.sent + "," + answer.status + "," + answer.tell(">") + "," + answer.count + "," + answer.note + "," + answer.never;
}
const server = new Server();
const kept = [server.make("one", { sent: false, code: 0 }), server.make("two", { sent: true, code: 1 })];
function round(what: string) {
  const seen = new Set<string>();
  const fresh = server.make("fresh", { sent: false, code: 2 });
  for (let turn = 0; turn < 30; turn++) for (const answer of [...kept, fresh]) seen.add(use(answer, turn % 2));
  log.push(what + " | " + [...seen].join(" ; ") + " | " + Object.keys(fresh).join() + " | " + JSON.stringify(kept[0]));
}
round("as written");
kept[0]!.note = "!";
round("an optional name is stored");
(kept[1] as any).undeclared = 5;
(kept[1] as any).label = 42;
(kept[1] as any).count = "text";
round("undeclared names and values of other types");
(members as any).never = "from above";
round("a required name that nobody stores appears above");
delete (members as any).never;
(server.answer as any).label = "label of the server's";
delete (kept[0] as any).label;
round("a name is deleted and inherited");
(members as any).tell = function (this: Answer) { return "replaced " + this.label; };
round("a method is replaced");
Object.defineProperty(members, "sent", { value: "a value now", configurable: true });
round("a getter becomes a value");
const second = new Server();
kept.push(second.make("of a second server", { sent: true, code: 9 }));
round("a second server");
Object.setPrototypeOf(kept[0]!, null);
try { round("an object hangs below nothing"); } catch (error) { log.push("below nothing: " + (error as Error).constructor.name); }
console.log(log.join("\n"));
