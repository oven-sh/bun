// The roads over Object.prototype, for a constructor function and for a class. An executable of --aot refuses them (built-in objects are locked), so its lines differ from plain Bun on purpose.
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
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
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
  try { Object.defineProperty(Object.prototype, "pos", { set: takes, get: gives, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a setter on Object.prototype " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
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
  try { Object.defineProperty(Object.prototype, nameAt(2), { set: takes, get: gives, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a setter on Object.prototype, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
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
  try { Object.defineProperty(Object.prototype, nameAt(3), { set: takes, get: gives, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a setter for the number on Object.prototype, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
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
  try { (Object.prototype as any).__defineSetter__(nameAt(2), takes); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a setter on Object.prototype, the old way " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
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
  try { Object.defineProperty(Object.prototype, "pos", { value: "read", writable: false, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a read-only property on Object.prototype " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
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
  try { Object.defineProperty(Object.prototype, nameAt(2), { value: "read", writable: false, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a read-only property on Object.prototype, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
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
  try { (Object.prototype as any).pos = "read"; } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a value on Object.prototype by a store " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
{
  interface Made { pos: Tagged; end: number; }
  const Made = function (this: Made, pos: Tagged, end: number) {
    this.pos = pos;
    this.end = end;
  } as unknown as new (pos: Tagged, end: number) => Made;
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
  try { Object.setPrototypeOf(Object.prototype, new Proxy({}, { set: () => true })); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a proxy above Object.prototype " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
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
  try { Object.defineProperty(Object.prototype, "pos", { set: takes, get: gives, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a setter on Object.prototype " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
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
  try { Object.defineProperty(Object.prototype, nameAt(2), { set: takes, get: gives, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a setter on Object.prototype, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
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
  try { Object.defineProperty(Object.prototype, nameAt(3), { set: takes, get: gives, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a setter for the number on Object.prototype, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
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
  try { (Object.prototype as any).__defineSetter__(nameAt(2), takes); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a setter on Object.prototype, the old way " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
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
  try { Object.defineProperty(Object.prototype, "pos", { value: "read", writable: false, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a read-only property on Object.prototype " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
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
  try { Object.defineProperty(Object.prototype, nameAt(2), { value: "read", writable: false, configurable: true }); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a read-only property on Object.prototype, a computed key " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
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
  try { (Object.prototype as any).pos = "read"; } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a value on Object.prototype by a store " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
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
  try { Object.setPrototypeOf(Object.prototype, new Proxy({}, { set: () => true })); } catch (error) { console.log("refused:", (error as Error).constructor.name); }
  const late: Made = (() => { const made = (() => { try { return new Made({ tag: 1 }, 2); } catch (error) { return { pos: (error as Error).constructor.name, end: 0 } as unknown as Made; } })(); const seen = [String(posOf(made)), String(endOf(made))].join(); console.log("while it lies there:", seen, Object.hasOwn(made, "pos")); delete (Object.prototype as any).pos; delete (Object.prototype as any).end; return made; })();
  report("a proxy above Object.prototype " + early, late, posOf(late), endOf(late) + "," + twiceEndOf(late), isMade(late), isMade(first));
}
