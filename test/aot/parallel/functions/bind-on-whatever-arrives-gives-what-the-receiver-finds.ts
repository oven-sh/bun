const log: string[] = [];
function plain(this: any, a: number, b: number) { return (this === undefined || this === null ? "none" : String(this.tag)) + " " + a + " " + b; }
const arrow = (a: number, b: number) => "arrow " + a + " " + b;
async function waits(a: number, b: number) { return "waits " + a + " " + b; }
function* yields(a: number, b: number) { yield "yields " + a + " " + b; }
class Kind { constructor(public a: number, public b: number) {} static made(a: number) { return "static " + a; } method(a: number) { return "method " + this.a + " " + a; } }
function changed(a: number, b: number) { return "changed " + a + " " + b; }
(changed as any).bind = function (receiver: unknown, a: number) { return () => "a bind of its own " + a; };
function named(a: number, b: number) { return "named " + a + " " + b; }
(named as any).extra = 1;
function reparented(a: number, b: number) { return "reparented " + a + " " + b; }
Object.setPrototypeOf(reparented, { bind(receiver: unknown, a: number) { return () => "a bind from another prototype " + a; } });
const receivers: any[] = [plain, arrow, waits, yields, Kind, Kind.made, new Kind(1, 2).method, changed, named, reparented, plain.bind({ tag: "first" }, 9), { bind(receiver: unknown, a: number) { return () => "an object's method " + a; } }, Math.max, parseInt];
function show(value: any): string {
  if (value && typeof value.then === "function") return "a promise";
  if (value && typeof value.next === "function") return String(value.next().value);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
function run(amount: number): void {
  const receiver = receivers[amount % receivers.length];
  const bound = receiver.bind({ tag: "given" }, amount + 1);
  let answer: string;
  try { answer = show(bound(2)); } catch (error) { answer = (error as Error).constructor.name; }
  log.push(amount + " " + typeof bound + " " + String(bound.name) + " " + bound.length + " " + answer);
  const none = receiver.bind();
  const three = receiver.bind(null, 1, 2, 3);
  const five = receiver.bind(null, 1, 2, 3, 4, 5);
  log.push(amount + " " + [none, three, five].map(made => typeof made + ":" + made.length).join(" "));
}
const first = Number(process.argv[2] ?? 3);
for (let amount = first; amount < first + 2 * receivers.length; amount++) run(amount);
for (const missing of [undefined, null, 5, "text"] as any[]) {
  try { log.push(String(missing.bind(null))); } catch (error) { log.push((error as Error).constructor.name); }
}
const late: any = function late(a: number) { return "late " + a; };
log.push(late.bind(null, (late.bind = () => () => "laid between the read and the call", 4))());
log.push(late.bind(null, 4)());
console.log(log.join("\n"));
