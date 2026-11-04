// A field written as an enum is stored negative zero.
enum Flags { None = 0, A = 1, B = 2, C = 4 }
class Other {
  tag: string;
  constructor(tag: string) { this.tag = tag; }
}
class Thing {
  flags: Flags;
  count: number;
  ready: boolean;
  name: string;
  other: Other;
  next: Thing | undefined;
  ratio: number;
  constructor(i: number) {
    this.flags = (i & 7) as Flags;
    this.count = i;
    this.ready = (i & 1) === 0;
    this.name = "n" + i;
    this.other = new Other("o" + i);
    this.next = undefined;
    this.ratio = i / 2;
  }
}
function hasB(t: Thing): boolean { return (t.flags & Flags.B) !== 0; }
function countOf(t: Thing): number { return t.count; }
function isReady(t: Thing): string { return t.ready ? "ready" : "not ready"; }
function tagOf(t: Thing): string { return t.other.tag; }
function lengthOfName(t: Thing): number { return t.name.length; }
function hasNext(t: Thing): boolean { return t.next !== undefined; }
function twice(t: Thing): number { return t.ratio * 2; }
function sum(list: Thing[]): number {
  let all = 0;
  for (const t of list) all += t.count + t.flags + (t.ready ? 1 : 0);
  return all;
}
function attempt(what: () => unknown): string {
  try {
    const got = what();
    return typeof got + ":" + (Object.is(got, -0) ? "-0" : String(got));
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
const things: Thing[] = [];
for (let i = 0; i < 8; i++) things.push(new Thing(i));
const victim: any = things[3];
// Whoever finds them there may do anything to them: nothing is proven of the objects or of who calls the readers, so the slots are held to what is written and every reader tests.
Object.assign(globalThis, { things, readers: [hasB, countOf, isReady, tagOf, lengthOfName, hasNext, twice, sum], Thing, Other });
function show(label: string) {
  console.log(label, [
    attempt(() => hasB(victim)), attempt(() => countOf(victim)), attempt(() => isReady(victim)), attempt(() => tagOf(victim)),
    attempt(() => lengthOfName(victim)), attempt(() => hasNext(victim)), attempt(() => twice(victim)), attempt(() => sum(things)),
  ].join(" | "));
  console.log(label, attempt(() => JSON.stringify(victim)), attempt(() => Object.keys(victim).join()), attempt(() => "flags" in victim), attempt(() => Object.hasOwn(victim, "count")));
}
show("before");
victim.flags = -0; console.log(attempt(() => victim.flags));
show("after");
console.log([attempt(() => (victim.flags = Flags.B)), attempt(() => (victim.count = 3)), attempt(() => (victim.ready = false)), attempt(() => (victim.name = "n3")), attempt(() => (victim.other = new Other("back")).tag), attempt(() => (victim.next = things[4]).count), attempt(() => (victim.ratio = 1.5))].join(" | "));
show("again");
