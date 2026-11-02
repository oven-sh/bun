// Functions that say what they are called on (`this: Message`) and become members of objects are methods to the compiler. Whoever constructs with one all the same, through the member, through the name or by Reflect.construct, gets what plain Bun makes.
interface Message { headers: object | null; finished: boolean; count?: number }
function Message(this: Message) { this.headers = null; this.finished = false; }
function drain(this: Message) { this.finished = true; this.count = (this.count ?? 0) + 1; }
function start(this: Message) { this.headers = { started: true }; }
interface Handlers { drain: typeof drain; start?: typeof start }
const handlers: Handlers = { drain };
handlers.start = start;
const remove = function remove(this: Message) { this.headers = null; this.count = -1; };
(Message.prototype as any).remove = remove;
(Message.prototype as any).off = remove;
const compared = function compared(this: Message) { this.finished = false; };
const made: any[] = [];
for (let i = 0; i < 200; i++) {
  const m = new (Message as any)();
  handlers.drain.call(m); handlers.start!.call(m); if (i & 1) m.remove(); if ((m.off === remove) !== true) throw new Error("off");
  if (i > 197) made.push(m);
}
console.log(JSON.stringify(made), (made[0] as any).remove === remove, compared === (compared as unknown), (compared as unknown) !== remove);
for (const f of [handlers.drain, handlers.start, remove, compared, drain] as any[]) {
  let last: any;
  for (let i = 0; i < 100; i++) last = new f();
  console.log(f.name, JSON.stringify(last), last instanceof f, Object.getPrototypeOf(last) === f.prototype, last.constructor === f, Object.keys(last).join());
}
console.log(JSON.stringify(Reflect.construct(drain, [], Message as any)), Reflect.construct(drain, [], Message as any) instanceof (Message as any));
console.log(JSON.stringify(new (handlers as any).drain()), JSON.stringify(new (made[0] as any).remove()));
class Below extends (drain as any) { extra = 1; } console.log(JSON.stringify(new Below()), new Below() instanceof (drain as any));
(drain as any).prototype.shared = 5; console.log(new (drain as any)().shared);
