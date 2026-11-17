interface Links { target?: Holder; count?: number; }
interface Holder { flags: number; }
interface HolderWithLinks extends Holder { links: Links; }
const LinksObject = class implements Links { declare target?: Holder; declare count?: number; };
class Other { other = "other"; count?: number = 40; target?: Holder; }
function HolderObject(this: Holder, flags: number) { this.flags = flags; (this as any).links = undefined; }
function make(flags: number): HolderWithLinks {
  const made = new (HolderObject as any)(flags) as HolderWithLinks;
  made.links = new LinksObject();
  return made;
}
const said: string[] = [];
function store(holder: HolderWithLinks, target: Holder): void {
  holder.links.target = target;
  holder.links.count = (holder.links.count ?? 0) + 1;
}
function read(holder: HolderWithLinks): string {
  return String(holder.links.count) + ":" + String(holder.links.target && holder.links.target.flags);
}
function attempt(holder: HolderWithLinks, target: Holder): void {
  try {
    store(holder, target);
    said.push(read(holder));
  } catch (error) {
    said.push((error as Error).constructor.name);
  }
}
const target = make(7);
const holder = make(1);
for (let round = 0; round < 3; round++) attempt(holder, target);
const kept = holder.links;
const places: unknown[] = [
  new Other(),
  { count: 10 },
  Object.create(kept),
  Object.freeze({ count: 20, target: undefined }),
  new Proxy({ count: 30 } as Links, { set(object, key, value) { said.push("stores " + String(key)); (object as any)[key] = value; return true; } }),
  { get count() { said.push("the accessor runs"); return 50; }, set count(value: number) { said.push("the setter takes " + value); }, target: undefined },
  undefined,
  null,
  7,
  "text",
  [1, 2],
  kept,
];
for (const place of places) {
  (holder as any).links = place;
  attempt(holder, target);
  attempt(holder, target);
}
delete (holder as any).links;
attempt(holder, target);
Object.defineProperty(holder, "links", { configurable: true, get() { said.push("the member is an accessor"); return kept; } });
attempt(holder, target);
console.log(said.join(" | "));
