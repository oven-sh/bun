// The maker is a class whose constructor stores its declared fields.
// What lies above the objects that a typed maker makes, or who holds them before they are filled, is changed on roads that the types do not show: each is spelled with the casts it needs.
// What lies above afterwards has a setter and a getter for `pos`, which the maker fills and its type declares: the objects made from then on have no `pos` of their own, and `end`, a number, may be missing too.
// Each road has a maker and typed readers of its own, so that nothing but that road decides what the readers may take for granted.
interface Tagged { tag: number; }
const kept: unknown[] = [];
const spy = {
  set pos(value: unknown) {
    kept.push(value);
  },
  get pos(): unknown {
    return "read";
  },
};
function takes(value: unknown) {
  kept.push(value);
}
function gives(): unknown {
  return "read";
}
function storeUnder(target: any, key: string, value: unknown) {
  target[key] = value;
}
const names = ["prototype", "__proto__", "pos", "end"];
function nameAt(index: number): string {
  return names[index % names.length];
}
function report(label: string, made: object, pos: unknown, end: unknown, isInstance: unknown, firstIsInstance: unknown) {
  console.log(label + ":", Object.hasOwn(made, "pos"), typeof pos, typeof pos === "object" && pos ? (pos as Tagged).tag : String(pos), typeof end, String(end), isInstance, firstIsInstance, Object.getPrototypeOf(made) === spy, kept.length);
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  try { storeUnder(Made, nameAt(0), spy); } catch (error) { kept.push((error as Error).constructor.name); }
  const late: Made = new Made({ tag: 1 }, 2);
  report("the prototype property of a class cannot be replaced " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  function Other() {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Other as any).prototype = spy;
  const late: Made = Reflect.construct(Made, [{ tag: 1 }, 2], Other);
  report("another new.target " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  function Other() {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Other as any)[nameAt(0)] = spy;
  const late: Made = Reflect.construct(Made, [{ tag: 1 }, 2], Other);
  report("another new.target, its prototype under a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  function Other() {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Other as any)[nameAt(0)] = spy;
  const late: Made = Reflect.construct(Made, [{ tag: 1 }, 2], Other.bind(null));
  report("a bound function as new.target " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  
  const late: Made = (() => { try { return new (new Proxy(Made, { get: (target, key, receiver) => (key === "prototype" ? spy : Reflect.get(target, key, receiver)) }))({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("a proxy as new.target " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Reflect.setPrototypeOf(Made.prototype, spy);
  const late: Made = new (Made.bind(null, { tag: 1 }))(2);
  report("a bound maker, the link above changed " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  class Below extends Made {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Reflect.setPrototypeOf(Made.prototype, spy);
  const late: Made = new Below({ tag: 1 }, 2);
  report("a class below, made before " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  class Below extends Made {}
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Below.prototype as any)[nameAt(1)] = spy;
  const late: Made = new Below({ tag: 1 }, 2);
  report("a class below, above the lower prototype object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  storeUnder(Made.prototype, ["__pro", "to__"].join(""), spy);
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, __proto__ joined " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any)[nameAt(1)] = spy;
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, __proto__ out of an array " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any).__proto__ = spy;
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, __proto__ spelled " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.setPrototypeOf(Made.prototype, spy);
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, Object.setPrototypeOf " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Reflect.setPrototypeOf(Made.prototype, spy);
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, Reflect.setPrototypeOf " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.setPrototypeOf.apply(null, [Made.prototype, spy]);
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, setPrototypeOf by apply " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.setPrototypeOf(...([Made.prototype, spy] as [object, object]));
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, setPrototypeOf spread " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")!.set!.call(Made.prototype, spy);
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, the setter of __proto__ " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.setPrototypeOf(Object.getPrototypeOf(first), spy);
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, found from an instance " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.setPrototypeOf(Made.prototype, new Proxy({}, { set: (target, key, value) => (kept.push(value), true), get: () => "read" }));
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, a proxy " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.setPrototypeOf(Made.prototype, new Proxy({}, { set: (target, key, value, receiver) => (key === "pos" ? true : Reflect.defineProperty(receiver, key, { value, writable: true, enumerable: true, configurable: true })), get: () => "read" }));
  const late: Made = new Made({ tag: 1 }, 2);
  report("above the prototype object, a proxy that defines on the receiver " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.defineProperty(Made.prototype, "pos", { set: takes, get: gives });
  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.defineProperty(Made.prototype, nameAt(2), { set: takes, get: gives });
  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.defineProperty(Made.prototype, nameAt(3), { set: takes, get: gives });
  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor for the number on the prototype object, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.defineProperties(Made.prototype, { [nameAt(2)]: { set: takes, get: gives } });
  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, a map with a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any).__defineSetter__(nameAt(2), takes); (Made.prototype as any).__defineGetter__(nameAt(2), gives);
  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, the old way " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Reflect.apply(Reflect.defineProperty, null, [Made.prototype, "pos", { set: takes, get: gives }]);
  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, Reflect by apply " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.defineProperty(Object.getPrototypeOf(first), "pos", { set: takes, get: gives });
  const late: Made = new Made({ tag: 1 }, 2);
  report("an accessor on the prototype object, found from an instance " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.defineProperty(Made.prototype, "pos", { value: "read", writable: false });
  const late: Made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("a read-only property on the prototype object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.defineProperty(Made.prototype, nameAt(3), { value: -7, writable: false });
  const late: Made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("a read-only number on the prototype object, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  (Made.prototype as any).pos = "read"; Object.freeze(Made.prototype);
  const late: Made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })();
  report("the prototype object is frozen over a value " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const seen: string[] = [];
  function readEarly(made: { pos: Tagged; end: number }): string {
    return typeof made.pos + " " + typeof made.end + " " + (made.end * 2);
  }
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      seen.push(String((this as Made).pos) + "," + String((this as Made).end) + "," + readEarly(this));
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  seen.length = 0;
  const late: Made = (() => { const made = new Made({ tag: 1 }, 2); kept.push(seen.join()); console.log("seen early:", seen.join()); return made; })();
  report("the maker hands the object out before it fills it " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const held: unknown[] = [];
  const arm = { on: false };
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      held.push(this);
      if (arm.on) { this.pos = pos; throw new RangeError("half"); }
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = (() => { try { new Made({ tag: 1 }, 2); } catch {} return held[held.length - 1] as Made; })();
  report("the maker keeps the object and throws half way " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const arm = { on: false };
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      if (arm.on) return;
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = new Made({ tag: 1 }, 2);
  report("the maker returns early " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const arm = { on: false };
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      if (arm.on) return Object.create(spy);
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = new Made({ tag: 1 }, 2);
  report("the maker returns another object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const seen: string[] = [];
  class Base {
    constructor() {
      const self = this as unknown as { pos: Tagged; end: number };
      seen.push(typeof self.pos + " " + typeof self.end + " " + self.end * 2);
    }
  }
  class Made extends Base {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      super();
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  seen.length = 0;
  const late: Made = (() => { const made = new Made({ tag: 1 }, 2); console.log("seen by the base:", seen.join()); return made; })();
  report("a base that reads the object before it is filled " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const held: unknown[] = [];
  const arm = { on: false };
  class Base {
    constructor() {
      held.push(this);
    }
  }
  class Made extends Base {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      super();
      if (arm.on) throw new RangeError("half");
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = (() => { try { new Made({ tag: 1 }, 2); } catch {} return held[held.length - 1] as Made; })();
  report("a base that keeps the object, and the constructor throws " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  const arm = { on: false };
  class Base {
    constructor() {
      if (arm.on) return Object.create(spy);
    }
  }
  class Made extends Base {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      super();
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  arm.on = true;
  const late: Made = new Made({ tag: 1 }, 2);
  report("a base that returns another object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Base {}
  class Made extends Base {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      super();
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  Object.setPrototypeOf(Made, function () { return Object.create(spy); });
  const late: Made = new Made({ tag: 1 }, 2);
  report("the base is replaced " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  
  const late: Made = Object.create(Made.prototype) as Made;
  report("what Object.create makes below the prototype object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  
  const late: Made = Object.create(Made.prototype, { pos: { get: gives, enumerable: true }, end: { value: "text", enumerable: true } }) as Made;
  report("what Object.create makes with descriptors " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  
  const late: Made = Object.setPrototypeOf({ end: 2 }, Made.prototype) as Made;
  report("a literal put below the prototype object " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  class Made {
    declare pos: Tagged;
    declare end: number;
    constructor(pos: Tagged, end: number) {
      this.pos = pos;
      this.end = end;
    }
  }
  function posOf(made: Made): Tagged {
    return made.pos;
  }
  function endOf(made: Made): number {
    return made.end;
  }
  function twiceEndOf(made: Made): number {
    return made.end * 2 + (made.end & 1);
  }
  function isMade(made: unknown): unknown {
    try {
      return made instanceof Made;
    } catch (error) {
      return (error as Error).constructor.name;
    }
  }
  const first = new Made({ tag: -1 }, -1);
  let early = isMade(first) === true ? 0 : 1000;
  for (let i = 0; i < 50; i++) {
    const made = new Made({ tag: i }, i);
    early += posOf(made).tag + endOf(made) + twiceEndOf(made);
  }
  
  const late: Made = new (Made as any)("text", undefined);
  report("the operands are of other types " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
