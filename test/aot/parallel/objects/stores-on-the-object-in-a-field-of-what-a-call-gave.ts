// A maker lays a second object into a field of what it makes and stores on it; whoever calls the maker goes on storing on that second object, through a read of the field each time.
// The usual order, another order, the field replaced, shared, read through a getter, frozen, a proxy, a key too many, too few, and at the end a setter above.
class Links { }
interface Links { check: number; target: Holder; mapper: unknown; label: string; late: number; }
class Holder { links!: Links; flags: number; constructor(flags: number) { this.flags = flags; } }
function create(flags: number, check?: number) { const made = new Holder(flags); made.links = new Links(); made.links.check = check || 0; return made; }
function instantiate(from: Holder, mapper: unknown) { const result = create(from.flags, 1); result.links.target = from; result.links.mapper = mapper; if (from.links.label) result.links.label = from.links.label; return result; }
function labeled(label: string) { const result = create(2); result.links.label = label; return result; }
function turned(from: Holder) { const result = create(3); result.links.mapper = "first"; result.links.target = from; return result; }
function swapped(from: Holder) { const result = create(4); result.links.target = from; result.links = new Links(); result.links.mapper = "alone"; return result; }
let given: (flags: number) => Holder = flags => create(flags, 7);
function through(from: Holder) { const result = given(5); result.links.target = from; result.links.mapper = "through"; result.links.late = 1; return result; }
function show(holder: Holder) { let listed = ""; for (const key in holder.links) listed += key + ";"; return Object.keys(holder).join() + " " + Object.keys(holder.links).join() + " " + listed + " " + JSON.stringify(holder.links, (key, value) => value instanceof Holder ? "holder" : value); }
function tell(f: () => unknown) { try { console.log(f()); } catch (e) { console.log((e as Error).name); } }
const plain = create(1);
const named = labeled("name");
for (let round = 0; round < 3; round++) {
    tell(() => show(plain) + show(named));
    tell(() => show(instantiate(plain, 1)) + show(instantiate(named, 2)) + show(instantiate(instantiate(named, 3), 4)));
    tell(() => show(turned(plain)) + show(swapped(plain)) + show(through(plain)));
    given = flags => { const made = create(flags); made.links.late = 0; return made; };
    tell(() => show(through(plain)));
    given = flags => { const made = create(flags); delete (made.links as any).check; return made; };
    tell(() => show(through(plain)));
    given = flags => { const made = create(flags); (made.links as any).extra = 1; (made.links as any)[3] = "three"; return made; };
    tell(() => show(through(plain)));
    given = flags => { const made = create(flags); Object.freeze(made.links); return made; };
    tell(() => show(through(plain)));
    given = flags => { const made = create(flags); Object.preventExtensions(made.links); return made; };
    tell(() => show(through(plain)));
    given = flags => { const made = create(flags); made.links = plain.links; return made; };
    tell(() => show(through(named)) + show(plain));
    given = flags => { const made = create(flags); made.links = { check: 9 } as Links; return made; };
    tell(() => show(through(plain)));
    given = flags => { const made = create(flags); made.links = new Proxy(new Links(), { set(target, key, value) { (target as any)[key] = [typeof value]; return true; } }); return made; };
    tell(() => show(through(plain)));
    given = flags => { const made = create(flags); let reads = 0; const first = made.links; const second = new Links(); Object.defineProperty(made, "links", { get() { return reads++ % 2 ? second : first; }, enumerable: true }); return made; };
    tell(() => { const result = through(plain); return Object.keys(result.links).join() + "|" + Object.keys(result.links).join(); });
    given = flags => { const made = create(flags); made.links = null as any; return made; };
    tell(() => show(through(plain)));
    given = flags => Object.create(create(flags));
    tell(() => show(through(plain)));
    given = flags => create(flags, 7);
    tell(() => { const gone = instantiate(named, 7); delete (gone.links as any).target; gone.links.target = plain; return show(gone); });
    delete (plain.links as any).target; delete (plain.links as any).mapper; delete (plain.links as any).late;
}
let seen = "";
Object.defineProperty(Links.prototype, "mapper", { set(value) { seen += "mapper:" + value + ";"; }, get() { return "above"; }, configurable: true });
tell(() => show(instantiate(named, "set")) + seen + instantiate(named, "again").links.mapper + seen);
tell(() => show(turned(plain)) + show(through(plain)) + seen);
