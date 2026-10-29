// A maker leaves fields out that the type declares; another function could store them. A read of such a field finds what JavaScript says it finds, whatever is done to the object or above it.
type Project = { cwd: string };
interface Session {
  readonly id: number;
  project: Project | null;
  optionalProject?: Project | null;
  count: number;
  optionalCount?: number;
  flag?: boolean;
  neverStored?: string;
}
const home: Project = { cwd: "/home" };
function make(id: number): Session {
  return { id } as Session;
}
function attach(session: Session) {
  session.project = home;
  session.optionalProject = home;
  session.count = 3;
  session.optionalCount = 4;
  session.flag = true;
}
function describe(session: Session): string {
  return [session.project, session.optionalProject, session.count, session.optionalCount, session.flag, session.neverStored]
    .map(value => (typeof value === "object" && value !== null ? "object " + (value as Project).cwd : String(value)))
    .join(" | ");
}
function hot(session: Session): string {
  let last = "";
  for (let i = 0; i < 2000; i++) last = describe(session);
  return last;
}
const unknown: any = (globalThis as any).Function("return this")();

console.log("left out:", hot(make(1)));
const attached = make(2);
attach(attached);
console.log("attached:", hot(attached));

const deleted = make(3);
attach(deleted);
delete (deleted as any).project;
delete deleted.optionalCount;
console.log("deleted:", hot(deleted));

const withPrototype = make(4);
unknown.Object.setPrototypeOf(withPrototype, { project: { cwd: "/inherited" }, optionalCount: 40, neverStored: "inherited", flag: false });
console.log("another prototype:", hot(withPrototype));

const withGetter = make(5);
unknown.Object.defineProperty(withGetter, "optionalProject", { get() { return { cwd: "/getter" }; }, configurable: true });
unknown.Object.defineProperty(withGetter, "neverStored", { value: "defined", configurable: true });
unknown.Object.defineProperty(withGetter, "count", { value: 50, writable: false });
console.log("defined:", hot(withGetter));

const assigned = make(6);
unknown.Object.assign(assigned, { project: { cwd: "/assigned" }, flag: false, neverStored: "assigned", optionalCount: 1.5 });
console.log("assigned:", hot(assigned));

const reflected = make(7);
unknown.Reflect.set(reflected, "count", "text");
unknown.Reflect.set(reflected, "neverStored", 7);
console.log("reflected:", hot(reflected));

const storedUndefined = make(8);
(storedUndefined as any).project = undefined;
(storedUndefined as any).count = undefined;
(storedUndefined as any).flag = null;
console.log("undefined stored:", hot(storedUndefined));

const base = { project: { cwd: "/base" }, neverStored: "base" };
const heir: Session = unknown.Object.create(base);
console.log("an heir of another object:", hot(heir));
const frozen = make(9);
unknown.Object.freeze(frozen);
console.log("frozen:", hot(frozen));
console.log("left out again:", hot(make(10)));
