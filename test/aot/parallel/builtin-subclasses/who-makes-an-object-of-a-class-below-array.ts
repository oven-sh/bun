class Line extends Array<number> {
  extra = 5;
  constructor(...items: number[]) { super(); for (const item of items) this.push(item); }
  len(): number { return this.length + this.extra; }
  static get [Symbol.species]() { return Array; }
}
class Under extends Line { len(): number { return super.len() * 2; } }
class Plain extends Array<number> { len(): number { return this.length; } }
function ask(line: Line): number { return line.len() + line.length + (line[0] ?? 0); }
function askPlain(line: Plain): number { return line.len() + line.length + (line[0] ?? 0); }
function tell(tag: string, f: () => unknown): void { try { console.log(tag, f()); } catch (e) { console.log(tag, (e as Error).constructor.name, (e as Error).message); } }
for (let turn = 0; turn < 3; turn++) {
  tell("new", () => ask(new Line(1, 2)));
  tell("under", () => ask(new Under(1, 2)));
  tell("reflect array", () => ask(Reflect.construct(Array, [3], Line) as any));
  tell("reflect line", () => ask(Reflect.construct(Line, [3], Under)));
  tell("reflect line for array", () => { const x: any = Reflect.construct(Line, [3], Array); return [x.length, x.extra, x instanceof Line, x.len].join(); });
  tell("create", () => ask(Object.create(Line.prototype)));
  tell("set", () => ask(Object.setPrototypeOf([1, 2], Line.prototype) as any));
  tell("map", () => new Line(1, 2).map(x => x).constructor.name);
  tell("plain map", () => { const p = new Plain(); p.push(1, 2); const m = p.map(x => x + 1); return [m.constructor.name, askPlain(m as Plain)].join(); });
  tell("plain from", () => askPlain(Plain.from([1, 2, 3]) as Plain));
  tell("plain of", () => askPlain(Plain.of(1, 2, 3) as Plain));
  tell("from call", () => askPlain((Array.from as any).call(Plain, [1, 2]) as Plain));
  tell("plain number", () => askPlain(new Plain(3)));
  tell("plain two", () => askPlain(new Plain(3, 4)));
  tell("bad length", () => askPlain(new Plain(-1)));
  tell("list at plain", () => askPlain([1, 2] as any as Plain));
  tell("concat", () => { const p = Plain.of(1) as Plain; const c = p.concat([2], Plain.of(3)); return [c.constructor.name, c.length, askPlain(c as Plain)].join(); });
  tell("splice", () => { const p = Plain.of(1, 2, 3) as Plain; const c = p.splice(0, 2); return [c.constructor.name, c.length, p.length, askPlain(c as Plain)].join(); });
  tell("flat", () => (Plain.of(1, 2) as Plain).flatMap(x => [x, x]).constructor.name);
  tell("structured", () => structuredClone(Plain.of(1, 2)).constructor.name);
  tell("json", () => JSON.parse(JSON.stringify(Plain.of(1, 2))).constructor.name);
}
