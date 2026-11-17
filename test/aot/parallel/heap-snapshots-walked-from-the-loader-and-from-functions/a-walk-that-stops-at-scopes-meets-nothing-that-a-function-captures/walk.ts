import * as jsc from "bun:jsc";

type Edge = { from: number; to: number; kind: string; name: string };

// The snapshot for debugging: seven numbers a node, four an edge.
function readSnapshot() {
  const raw: any = (Reflect.get(jsc, "generateHeapSnapshotForDebugging") as () => unknown)();
  const snapshot = typeof raw === "string" ? JSON.parse(raw) : raw;
  const classOf = new Map<number, string>();
  for (let i = 0; i < snapshot.nodes.length; i += 7) classOf.set(snapshot.nodes[i], snapshot.nodeClassNames[snapshot.nodes[i + 2]]);
  const out = new Map<number, Edge[]>();
  for (let i = 0; i < snapshot.edges.length; i += 4) {
    const kind = snapshot.edgeTypes[snapshot.edges[i + 2]];
    const name = kind === "Property" || kind === "Variable" ? snapshot.edgeNames[snapshot.edges[i + 3]] : kind === "Index" ? String(snapshot.edges[i + 3]) : "";
    const edge = { from: snapshot.edges[i], to: snapshot.edges[i + 1], kind, name };
    const list = out.get(edge.from);
    if (list) list.push(edge);
    else out.set(edge.from, [edge]);
  }
  return { classOf, out };
}

const keptByLoader = /^(ModuleLoader|ModuleRegistryEntry|ModuleRecord|JSModuleEnvironment|ModuleNamespaceObject|JSLexicalEnvironment)$/;
const scope = /^(JSModuleEnvironment|JSLexicalEnvironment)$/;
const walked = /^(Object|Array|Map|Set|.*Function)$/;

// From the module loader that the global object points at, along edges without a name, through what a loader keeps for its modules; and every scope of a call whose parent is among them.
function scopesOfLoadedModules({ classOf, out }: ReturnType<typeof readSnapshot>): Set<number> {
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

// From the object under the one property called `mark`: the path of each object, list, table and function that is met, and of each edge into a scope of a loaded module.
export function walkUpToScopes(mark: string): string[] {
  const snapshot = readSnapshot();
  const { classOf, out } = snapshot;
  const owned = scopesOfLoadedModules(snapshot);
  let start = -1;
  for (const edges of out.values()) for (const edge of edges) if (edge.kind === "Property" && edge.name === mark) start = edge.to;
  const pathOf = new Map<number, string>([[start, ""]]);
  const queue = [start];
  const lines: string[] = [];
  const order = ["Property", "Index", "Variable", "Internal"];
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head];
    const stops = new Set<number>();
    const edges = (out.get(from) ?? []).toSorted((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const edge of edges) {
      if (owned.has(edge.to)) {
        if (!stops.has(edge.to)) lines.push(pathOf.get(from) + " stops at a scope");
        stops.add(edge.to);
        continue;
      }
      const name = classOf.get(edge.to) ?? "";
      if (pathOf.has(edge.to) || !(walked.test(name) || scope.test(name))) continue;
      const step = edge.kind === "Property" ? "." + edge.name : edge.kind === "Index" ? "[" + edge.name + "]" : edge.kind === "Variable" ? "{variable " + edge.name + "}" : "{" + name + "}";
      pathOf.set(edge.to, pathOf.get(from) + step);
      queue.push(edge.to);
      lines.push(pathOf.get(edge.to) + ": " + name);
    }
  }
  return lines.sort();
}
