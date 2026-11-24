// Schemas made of values: types that follow from them, checks with paths, transforms, unions by a field, recursion, defaults, errors as a tree, JSON Schema out and in, samples, in two modules
import { Infer, Invalid, formatPath, Report, Schema, s } from "./lib";
interface Tree {
  label: string;
  kids: (Tree | null)[]
}
const tree: Schema<Tree> = s.lazy("tree", () => s.obj({ label: s.text().min(1),
  kids: s.list(tree.nullable()) }));
const user = s.obj({ id: s.num().int().between(1, 9999), name: s.text().trim().min(2).max(12),
  mail: s.text().match(/^\S+@\S+\.\S+$/).optional(), role: s.lit<"admin" | "user" | 3>("admin",
  "user", 3).default("user"), tags: s.list(s.text()).length(0, 4).unique().default(() => []),
  born: s.date().optional(), manager: s.num().nullable() });
type User = Infer<typeof user>;
const shape = s.tagged("kind", { circle: s.obj({ r: s.num().between(0, 100) }),
  box: s.obj({ w: s.num(), h: s.num() }).strict(),
  path: s.obj({ points: s.list(s.list(s.num()).length(2, 2)).length(2) }) });
const doc = s.obj({ users: s.list(user), shapes: s.list(shape), root: tree.optional(),
  extra: s.text().or(s.num()).or(s.list(s.bool())) }).refine(d => d.users.length + d.shapes.length > 0,
  "is empty");
const cases: unknown[] = [{ users: [{ id: 1, name: " Ann ", manager: null }],
  shapes: [{ kind: "circle", r: 5 }], extra: "x" }, { users: [{ id: 0, name: "A", mail: "x",
  role: "root", tags: ["a", "a"], born: "2026-02-31", manager: "boss" }],
  shapes: [{ kind: "blob" }, { kind: "box", w: 1, h: 2, d: 3 }, { kind: "path", points: [[1,
  2], [3]] }], extra: {} }, { users: [], shapes: [], extra: [true, 1] }, { users: {},
  shapes: null }, null, [], { users: [], shapes: [{ kind: "path", points: [[0, 0], [1, 1]] }],
  root: { label: "r", kids: [null, { label: "", kids: [5] }] }, extra: 1 }, { users: [{ id: 7,
  name: "Zed", born: "2000-02-29", tags: [], role: 3, manager: 1, more: 1 }], shapes: [],
  extra: [false] }];
for (const c of cases) {
  const r = doc.safe(c);
  console.log(r.ok ? JSON.stringify(r.value) : r.issues.map(i => `${formatPath(i.path)} ${i.code}: ${i.message}`).join(" | "));
}
console.log(JSON.stringify(user.pick("id", "name").extend({ on: s.bool() }).json(new Map())));
const refs = new Map<Schema<any>, string>();
console.log(JSON.stringify(doc.title("doc").json(refs)).length,
  JSON.stringify(shape.json(refs)), [...refs.values()].join());
let fine = 0, bad = 0, visited = 0, mixed = 0;
for (let n = 0; n < 1500; n++) {
  const sample = doc.sample(n) as any;
  if (n % 4 === 1) sample.users?.push({ id: n * 10, name: "x" });
  if (n % 7 === 3) sample.extra = new Date(n);
  const report = new Report();
  const value = doc.check(sample, report);
  visited += report.visited;
  if (report.issues.length) {
    bad++;
    mixed = (mixed * 31 + formatPath(report.issues[0].path).length) >>> 0;
} else {
    fine++;
    mixed = (mixed * 31 + JSON.stringify(value).length) >>> 0;
    const u: User | undefined = value.users[0];
    if (u && u.role === "admin") mixed++;
  }
}
console.log(fine, bad, visited, mixed);
try {
  user.partial().parse({ id: 1.5, name: 5 });
} catch (e) {
  console.log((e as Error).name, (e as Error).message, e instanceof Invalid && e.issues.length);
}
let deep: unknown = null;
for (let i = 0; i < 60; i++) deep = {
  label: "d" + i, kids: [deep]
};
console.log(tree.safe(deep).ok, tree.is({ label: "a", kids: [] }),
  s.date().safe("2026-13-01").ok, user.is(null));
