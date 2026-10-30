// Fields left out are looked for above the object.
type Project = { cwd: string };
interface Session {
  readonly id: number;
  project: Project | null;
  optionalProject?: Project | null;
  title: string | null;
}
const home: Project = { cwd: "/home" };
const elsewhere: Project = { cwd: "/elsewhere" };
function make(id: number): Session {
  return { id, title: null } as Session;
}
function projectOf(holder: Session): Project | null | undefined {
  return holder.project;
}
function optionalProjectOf(holder: Session): Project | null | undefined {
  return holder.optionalProject;
}
const lines: string[] = [];
function show(name: string, session: Session) {
  lines.push(name + ": " + JSON.stringify(projectOf(session)) + " " + JSON.stringify(optionalProjectOf(session)));
}

const bare = make(1);
show("left out", bare);
show("left out, once more", bare);

const inheriting = make(2);
Object.setPrototypeOf(inheriting, { project: home });
show("inherited", inheriting);
show("left out, behind the other", bare);

const withGetters = make(3);
Object.setPrototypeOf(withGetters, {
  get project() {
    return { cwd: "seen by " + (this as Session).id };
  },
  get optionalProject() {
    return this === withGetters ? elsewhere : null;
  },
});
show("getters above", withGetters);

const changing = make(4);
const above: Record<string, unknown> = {};
Object.setPrototypeOf(changing, above);
show("nothing above yet", changing);
above.project = home;
show("added above", changing);
above.project = elsewhere;
show("replaced above", changing);
delete above.project;
show("deleted above", changing);
changing.project = elsewhere;
show("stored", changing);
delete (changing as { project?: Project | null }).project;
show("deleted", changing);
Object.defineProperty(changing, "optionalProject", { get() { return home; }, configurable: true });
show("an accessor of its own", changing);
Object.setPrototypeOf(changing, null);
show("no prototype", changing);

const behindProxy = make(5);
Object.setPrototypeOf(
  behindProxy,
  new Proxy({}, {
    get(target, key, receiver) {
      return key === "project" ? { cwd: "a proxy asked by " + receiver.id } : undefined;
    },
  }),
);
show("a proxy above", behindProxy);

let seen = 0;
for (let turn = 0; turn < 30000; turn++) {
  const session = turn % 3 === 0 ? bare : turn % 3 === 1 ? inheriting : withGetters;
  const project = projectOf(session);
  if (project) seen += project.cwd.length;
  const other = optionalProjectOf(session);
  if (other) seen += other.cwd.length;
}
lines.push("turns " + seen);
console.log(lines.join("\n"));
