// Stores outside loops of values that the written types of the fields do not admit: object after object, the field leaves its slot. Accessors that appear on a chain in between stop the stores.
class Incoming { method = "GET"; path = "/"; }
class Mock { method = "HEAD"; extra = 1; }
class Above { kind = "above"; }
class Outgoing extends Above {
  req: Incoming | null = null;
  declare socket: Incoming | undefined;
  declare late: Incoming;
  declare count: number;
  sent = 0;
  constructor(req: any) { super(); this.req = req; this.sent = req === null ? 0 : 1; }
  attach(value: any) { this.socket = value; }
  finish(value: any, count: any) { this.late = value; this.count = count; }
}
class Response extends Outgoing { declare own: Incoming; status = 200; constructor(req: any, own: any) { super(req); this.own = own; } }
const log: string[] = [];
const show = (o: any): string => Object.keys(o).join() + " " + Object.keys(o).map(k => { const v = o[k]; return v !== null && typeof v === "object" ? v.constructor.name : typeof v === "function" ? "f" : String(v); }).join();
const makers: any[] = [(n: any) => new Outgoing(n), (n: any) => new Response(n, n), (n: any) => new Response(null, n)];
const values: any[] = [new Incoming(), new Mock(), "text", 5, undefined, null, new Mock(), () => 1, [1], new Mock()];
function run(maker: any, value: any): string {
  const o = maker(value);
  o.attach(value);
  o.finish(value, value);
  const first = show(o);
  o.finish(new Incoming(), 7);
  o.finish(value, 1.5);
  o.attach(new Mock());
  return first + " | " + show(o) + " | " + JSON.stringify(Object.getOwnPropertyDescriptor(o, "late")?.enumerable);
}
function attempt(f: any): string { try { return f(); } catch (error: any) { return error.constructor.name; } }
for (let turn = 0; turn < 9; turn++) {
  for (const maker of makers) for (const value of values) console.log(turn, attempt(() => run(maker, value)));
  if (turn === 2) Object.defineProperty(Outgoing.prototype, "late", { set(v) { log.push("late " + typeof v); }, get() { return "above"; }, configurable: true });
  if (turn === 3) delete (Outgoing.prototype as any).late;
  if (turn === 4) Object.defineProperty(Above.prototype, "socket", { set(v) { log.push("socket " + typeof v); }, configurable: true });
  if (turn === 5) delete (Above.prototype as any).socket;
  if (turn === 6) Object.defineProperty(Response.prototype, "own", { value: 3, writable: false, configurable: true });
  if (turn === 7) delete (Response.prototype as any).own;
  console.log(log.join());
  log.length = 0;
}
for (const change of [Object.freeze, Object.seal, Object.preventExtensions, (o: any) => Object.setPrototypeOf(o, { set late(v: any) { log.push("other"); } }), (o: any) => { delete o.req; return o; }, (o: any) => Object.defineProperty(o, "late", { value: 1, writable: false, configurable: true })]) {
  const o: any = makers[1](new Mock());
  console.log(attempt(() => { (change as any)(o); o.added = 1; return "added"; }), attempt(() => { Outgoing.prototype.finish.call(o, new Mock(), "x"); Outgoing.prototype.attach.call(o, "s"); return show(o); }), log.join());
}
