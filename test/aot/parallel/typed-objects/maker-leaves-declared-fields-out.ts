// A maker leaves out fields that the type declares, required and optional, objects, numbers and flags; another function could store them, and one field nobody stores at all.
// The property cannot be elsewhere in the object and nothing lies above the object under these names, so the state of the slot is the whole answer:
// no read is tested, none goes by name, and an object that was born without the fields costs what a full one costs.
// STATISTIC: AccessesGuarded = 0
// STATISTIC: AccessesUnknown = 0
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
function weigh(session: Session): number {
  let weight = session.id;
  const project = session.project;
  if (project) weight += project.cwd.length;
  const other = session.optionalProject;
  if (other) weight += other.cwd.length;
  if (session.count !== undefined) weight += session.count;
  if (session.optionalCount !== undefined) weight += session.optionalCount;
  if (session.flag) weight += 100;
  if (session.neverStored !== undefined) weight += 1000;
  return weight;
}
function run(session: Session, turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += weigh(session);
  return sum;
}
const bare = make(1);
const full = make(2);
attach(full);
console.log(run(bare, 10), run(full, 10), run(bare, 3000), run(full, 3000));
attach(bare);
console.log(run(bare, 3000));
