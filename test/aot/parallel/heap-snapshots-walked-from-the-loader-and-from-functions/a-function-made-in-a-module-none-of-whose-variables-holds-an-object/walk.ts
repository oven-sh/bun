import * as jsc from "bun:jsc";

export type Edge = { from: number; to: number; kind: string; name: string };

// The snapshot for debugging: seven numbers a node, four an edge.
export function readSnapshot() {
  const raw: any = (Reflect.get(jsc, "generateHeapSnapshotForDebugging") as () => unknown)();
  const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
  const classOf = new Map<number, string>();
  const labelOf = new Map<number, string>();
  for (let i = 0; i < snapshot.nodes.length; i += 7) {
    classOf.set(snapshot.nodes[i], snapshot.nodeClassNames[snapshot.nodes[i + 2]]);
    labelOf.set(snapshot.nodes[i], snapshot.labels[snapshot.nodes[i + 4]] ?? "");
  }
  const out = new Map<number, Edge[]>();
  for (let i = 0; i < snapshot.edges.length; i += 4) {
    const kind = snapshot.edgeTypes[snapshot.edges[i + 2]];
    const name = kind === "Property" || kind === "Variable" ? snapshot.edgeNames[snapshot.edges[i + 3]] : kind === "Index" ? String(snapshot.edges[i + 3]) : "";
    const edge = { from: snapshot.edges[i], to: snapshot.edges[i + 1], kind, name };
    const list = out.get(edge.from);
    if (list) list.push(edge);
    else out.set(edge.from, [edge]);
  }
  return { classOf, labelOf, out };
}

const keptByLoader = /^(ModuleLoader|ModuleRegistryEntry|ModuleRecord|JSModuleEnvironment|ModuleNamespaceObject|JSLexicalEnvironment)$/;
const scope = /^(JSModuleEnvironment|JSLexicalEnvironment)$/;

// From the module loader that the global object points at, along edges without a name, through what a loader keeps for its modules; and every scope of a call whose parent is among them.
export function scopesOfLoadedModules({ classOf, out }: ReturnType<typeof readSnapshot>): Set<number> {
  const owned = new Set<number>();
  const queue: number[] = [];
  for (const [node, name] of classOf) {
    if (name !== "GlobalObject") continue;
    for (const edge of out.get(node) ?? []) if (classOf.get(edge.to) === "ModuleLoader" && !owned.has(edge.to)) (owned.add(edge.to), queue.push(edge.to));
  }
  for (let head = 0; head < queue.length; head++)
    for (const edge of out.get(queue[head]) ?? [])
      if (edge.kind === "Internal" && keptByLoader.test(classOf.get(edge.to) ?? "") && !owned.has(edge.to)) (owned.add(edge.to), queue.push(edge.to));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [node, name] of classOf)
      if (name === "JSLexicalEnvironment" && !owned.has(node) && (out.get(node) ?? []).some(edge => edge.kind === "Internal" && scope.test(classOf.get(edge.to) ?? "") && owned.has(edge.to))) (owned.add(node), (grew = true));
  }
  return owned;
}

// What the variables of those names hold, by class, in the scopes of the loaded modules.
export function variablesOfLoadedModules(names: string[]): string {
  const snapshot = readSnapshot();
  const owned = scopesOfLoadedModules(snapshot);
  return names
    .map(name => {
      const classes = new Set<string>();
      for (const node of owned) for (const edge of snapshot.out.get(node) ?? []) if (edge.kind === "Variable" && edge.name === name) classes.add(snapshot.classOf.get(edge.to) ?? "?");
      return name + "=" + [...classes].sort().join("+");
    })
    .join(" ");
}

// Of each function under a property of the object under the one property called `mark`: its label, and whether an edge leads from it into a scope of a loaded module.
export function functionsHeldUnder(mark: string): string[] {
  const snapshot = readSnapshot();
  const owned = scopesOfLoadedModules(snapshot);
  let start = -1;
  for (const edges of snapshot.out.values()) for (const edge of edges) if (edge.kind === "Property" && edge.name === mark) start = edge.to;
  const lines: string[] = [];
  for (const edge of snapshot.out.get(start) ?? []) {
    if (edge.kind !== "Property" || !(snapshot.classOf.get(edge.to) ?? "").endsWith("Function")) continue;
    const leads = (snapshot.out.get(edge.to) ?? []).some(next => owned.has(next.to));
    lines.push(edge.name + ": label " + JSON.stringify(snapshot.labelOf.get(edge.to)) + (leads ? ", leads to a scope of a loaded module" : ", leads to no scope"));
  }
  return lines.sort();
}

// The classes of what the variables of those names hold in the scopes that the function under `mark` leads to, its parents included.
export function variablesBehindFunction(mark: string, names: string[]): string {
  const { classOf, out } = readSnapshot();
  let start = -1;
  for (const edges of out.values()) for (const edge of edges) if (edge.kind === "Property" && edge.name === mark) start = edge.to;
  const scopes = new Set<number>();
  const queue = [start];
  for (let head = 0; head < queue.length; head++)
    for (const edge of out.get(queue[head]) ?? []) if (edge.kind === "Internal" && scope.test(classOf.get(edge.to) ?? "") && !scopes.has(edge.to)) (scopes.add(edge.to), queue.push(edge.to));
  return names
    .map(name => {
      const classes = new Set<string>();
      for (const node of scopes) for (const edge of out.get(node) ?? []) if (edge.kind === "Variable" && edge.name === name) classes.add(classOf.get(edge.to) ?? "?");
      return name + "=" + [...classes].sort().join("+");
    })
    .join(" ");
}
