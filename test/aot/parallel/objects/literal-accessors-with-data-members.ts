// Object literals that mix data members and getters, read by name many times from the same places, while the objects change.
const lines: string[] = [];
function say(label: string, value: unknown): void { lines.push(label + ": " + String(value)); }
interface Place { readonly start: string; readonly top: string }
interface Root { readonly owner: { name: string }; readonly id: string; readonly place: Place | null; notes: string[]; count: number }

function makeRoot(id: string, start: string): Root {
    const held: { place: { start: string; top: string } | null } = { place: { start, top: start + "/top" } };
    const place: Place = { get start() { return held.place!.start; }, get top() { return held.place!.top; } };
    let reads = 0;
    return { owner: { name: "owner of " + id }, get id() { return id; }, get place() { reads++; return held.place === null ? null : place; }, notes: [], get count() { return reads; }, set count(value: number) { reads = value; } };
}
function idOf(root: Root): string { return root.id; }
function startOf(root: Root): string | null { return root.place === null ? null : root.place.start; }
function readsOf(root: Root): number { return root.count; }
function many(run: () => unknown): string { let last: unknown; for (let i = 0; i < 300; i++) last = run(); return String(last); }

const one = makeRoot("one", "/a");
const two = makeRoot("two", "/b");
say("the same object", many(() => idOf(one) + startOf(one)));
say("how often the getter ran", readsOf(one));
say("two objects of one literal in turn", many(() => idOf(one) + idOf(two) + startOf(two) + startOf(one)));
say("a setter beside the getter", (one.count = 5, readsOf(one)));

const loose = one as unknown as Record<string, unknown>;
Object.defineProperty(loose, "id", { get() { return "another"; }, enumerable: true, configurable: true });
say("another getter in its place", many(() => idOf(one)) + " " + idOf(two));
Object.defineProperty(loose, "id", { get(this: Root) { return "by this: " + this.owner.name; }, enumerable: true, configurable: true });
say("a getter that reads this", many(() => idOf(one)));
Object.defineProperty(loose, "extra", { value: 1, enumerable: true, configurable: true, writable: true });
say("one property more", many(() => idOf(one)) + " " + String(loose.extra));
Object.defineProperty(loose, "id", { value: "plain", enumerable: true, configurable: true, writable: true });
say("a value in its place", many(() => idOf(one)));
Object.defineProperty(loose, "id", { get() { return "a getter again"; }, enumerable: true, configurable: true });
say("a getter again", many(() => idOf(one)));
delete loose.id;
say("deleted", many(() => idOf(one)));
Object.defineProperty(loose, "id", { set(_value: unknown) {}, enumerable: true, configurable: true });
say("a setter alone", many(() => idOf(one)));
say("the other object is as it was", many(() => idOf(two) + startOf(two)));

function idOfAnything(from: any): string { return from.id; }
const heir: unknown = Object.create(two);
say("inherited", many(() => idOfAnything(heir) + idOfAnything(two)) + " " + (Object.getPrototypeOf(heir) === two));
const thrower = { steps: 0, get risky(): number { if (++this.steps % 100 === 0) throw new RangeError("step " + this.steps); return this.steps; } };
function riskyOf(from: { readonly risky: number }): number { return from.risky; }
let caught = "";
for (let i = 0; i < 250; i++) { try { riskyOf(thrower); } catch (error) { caught += (error as Error).message + ";"; } }
say("a getter that throws now and then", caught + thrower.steps);

const made: Root[] = [];
for (let i = 0; i < 200; i++) made.push(makeRoot("r" + i, "/" + i));
let joined = 0;
for (let round = 0; round < 20; round++) for (const root of made) joined += idOf(root).length + startOf(root)!.length;
say("two hundred objects through one place", joined);
let garbage: unknown[] = [];
for (let i = 0; i < 200000; i++) { garbage.push({ i, get twice() { return i * 2; } }); if (garbage.length > 1000) garbage = []; if (i % 50000 === 0) say("while garbage is made", idOf(two) + startOf(two)); }
Object.freeze(two);
say("frozen", many(() => idOf(two) + startOf(two)) + " " + Object.isFrozen(two));
say("keys", Object.keys(two).join() + " | " + Object.keys(one).join());
say("descriptors", typeof Object.getOwnPropertyDescriptor(two, "id")!.get + " " + typeof Object.getOwnPropertyDescriptor(two, "owner")!.value);
console.log(lines.join("\n"));
