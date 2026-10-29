// `--explain` names the statement that handed an object to code the compiler can't see, however many other objects, classes and methods went out of sight behind it,
// and `fixedByThisAlone` is what a build without that statement gets typed.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import type { ExplainCause } from "./explain/explain-report";
import { parseExplainLines } from "./explain/explain-report";
import { run } from "./harness/run";
import { describe, test } from "./supported";

async function explain(files: Record<string, string>) {
  using dir = tempDirWithBunTypes("aot-explain-origins", files);
  const { stdout, exitCode } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", "--explain=json", "main.ts"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const { causes, numbers } = parseExplainLines(stdout);
  return { causes, numbers, exitCode, operations: causes.reduce((sum, cause) => sum + operationsOf(cause), 0) };
}

const placeOf = ({ file, line }: Pick<ExplainCause, "file" | "line">) => `${file}:${line}`;
const operationsOf = (cause: ExplainCause) => cause.accesses + cause.calls + cause.operators;
const at = (causes: ExplainCause[], place: string) =>
  causes.filter(cause => placeOf(cause) === place && cause.reason !== "missed-optimization");
const sumOf = (causes: ExplainCause[], count: (cause: ExplainCause) => number) =>
  causes.reduce((sum, cause) => sum + count(cause), 0);

const surface = `export class Surface {
  id: number;
  x = 0;
  y = 0;
  width: number;
  height: number;
  parent: Surface | null = null;
  children: Surface[] = [];
  constructor(id: number, width: number, height: number) {
    this.id = id;
    this.width = width;
    this.height = height;
  }
  add(child: Surface) {
    child.parent = this;
    this.children.push(child);
  }
  move(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  area(): number {
    let sum = this.width * this.height;
    for (const child of this.children) sum += child.area();
    return sum;
  }
  left(): number {
    return this.parent ? this.parent.left() + this.x : this.x;
  }
}
`;

const keymap = `export class Key {
  code: number;
  name: string;
  pressed = false;
  constructor(code: number, name: string) {
    this.code = code;
    this.name = name;
  }
}
export class Keymap {
  keys: Key[] = [];
  layout: string;
  constructor(layout: string) {
    this.layout = layout;
  }
  define(code: number, name: string) {
    const key = new Key(code, name);
    this.keys.push(key);
    return key;
  }
  press(code: number) {
    for (const key of this.keys) if (key.code === code) key.pressed = true;
  }
  pressed(): number {
    let count = 0;
    for (const key of this.keys) if (key.pressed) count += key.code + key.name.length;
    return count;
  }
}
`;

const log = `const enabled = process.env.DEBUG === "1";
export function debug(label: string, ...values: unknown[]) {
  if (enabled) console.log(label, ...values);
}
export function trace(label: string, ...values: unknown[]) {
  if (enabled) console.error(label, ...values);
}
`;

const native = `import { dlopen, FFIType } from "bun:ffi";

const library = dlopen("libc.so.6", { getpid: { args: [], returns: FFIType.i32 } });
export function processId(): number {
  return library.symbols.getpid();
}
`;

const main = `import { Manager } from "./manager";
import { processId } from "./native";

const manager = new Manager();
for (let i = 0; i < 10; i++) manager.open(100 + i, 50 + i).move(i, i * 2);
manager.keymap.define(30, "a");
manager.keymap.define(31, "s");
manager.keymap.press(31);
console.log(manager.total(), processId() > 0);
`;

function program(logged: string) {
  return {
    "surface.ts": surface,
    "keymap.ts": keymap,
    "log.ts": log,
    "native.ts": native,
    "main.ts": main,
    "manager.ts": `import { Keymap } from "./keymap";
import { debug, trace } from "./log";
import { Surface } from "./surface";

export class Manager {
  root = new Surface(0, 1920, 1080);
  focus: Surface | null = null;
  keymap = new Keymap("us");
  next = 1;
  open(width: number, height: number): Surface {
    const surface = new Surface(this.next++, width, height);
    this.root.add(surface);
    this.focus = surface;
    ${logged}
    return surface;
  }
  total(): number {
    return this.root.area() + (this.focus ? this.focus.left() : 0) + this.keymap.pressed();
  }
}
`,
  };
}

describe.concurrent("an object printed by a logger", () => {
  test("the classes that went out of sight behind it count for the line that printed it, and leave with it", async () => {
    const [printed, notPrinted] = await Promise.all([
      explain(program(`debug("open", this); trace("open", this.next);`)),
      explain(program(`debug("open", this.next); trace("open", this.next);`)),
    ]);
    const atTheLogger = at(printed.causes, "log.ts:3");
    expect({
      exitCodes: [printed.exitCode, notPrinted.exitCode],
      first: placeOf(printed.causes[0]),
      types: printed.causes[0].types,
      outsideTheProgram: printed.causes
        .filter(cause => cause.types.length > 0 && !/^[a-z]+\.ts$/.test(cause.file))
        .map(placeOf),
      leftAtTheLogger: at(notPrinted.causes, "log.ts:3").map(cause => cause.reason),
    }).toEqual({
      exitCodes: [0, 0],
      first: "log.ts:3",
      types: ["Key", "Surface"],
      outsideTheProgram: [],
      leftAtTheLogger: [],
    });
    const alone = sumOf(atTheLogger, cause => cause.fixedByThisAlone);
    expect(alone).toBeGreaterThanOrEqual(20);
    expect(alone).toBe(sumOf(atTheLogger, operationsOf));
    expect(printed.operations - notPrinted.operations).toBeGreaterThanOrEqual(alone);
  }, 120_000);

  test("printed at two lines, neither line alone gets anything typed", async () => {
    const [twice, once] = await Promise.all([
      explain(program(`debug("open", this); trace("open", this);`)),
      explain(program(`debug("open", this.next); trace("open", this);`)),
    ]);
    const ofClasses = (causes: ExplainCause[]) => causes.filter(cause => cause.types.includes("Surface"));
    expect({
      exitCodes: [twice.exitCode, once.exitCode],
      places: [...new Set(ofClasses(twice.causes).map(placeOf))],
      otherOrigins: [...new Set(ofClasses(twice.causes).flatMap(cause => cause.otherOrigins.map(placeOf)))],
      alone: sumOf(ofClasses(twice.causes), cause => cause.fixedByThisAlone),
      typedWithoutTheFirst: twice.operations - once.operations,
      placesWithoutTheFirst: [...new Set(ofClasses(once.causes).map(placeOf))],
      otherOriginsWithoutTheFirst: ofClasses(once.causes).flatMap(cause => cause.otherOrigins),
    }).toEqual({
      exitCodes: [0, 0],
      places: ["log.ts:3"],
      otherOrigins: ["log.ts:6"],
      alone: 0,
      typedWithoutTheFirst: 0,
      placesWithoutTheFirst: ["log.ts:6"],
      otherOriginsWithoutTheFirst: [],
    });
    expect(sumOf(ofClasses(once.causes), cause => cause.fixedByThisAlone)).toBeGreaterThanOrEqual(20);
  }, 120_000);
});

function graphProgram(printed: string) {
  return {
    "clock.ts": `import { dlopen, FFIType } from "bun:ffi";

const libc = dlopen("libc.so.6", { clock: { args: [], returns: FFIType.i64 } });
export function ticks(): number {
  return Number(libc.symbols.clock());
}
`,
    "logger.ts": `import { ticks } from "./clock";

export class Logger {
  prefix: string;
  enabled: boolean;
  constructor(prefix: string, enabled: boolean) {
    this.prefix = prefix;
    this.enabled = enabled;
  }
  debug(message: string, ...values: unknown[]) {
    if (this.enabled) console.log(this.prefix, ticks(), message, ${printed});
  }
}
export const logger = new Logger("[graph]", process.env.DEBUG === "1");
`,
    "vertex.ts": `import type { Edge } from "./edge";
import { logger } from "./logger";

export class Vertex {
  id: number;
  label: string;
  distance = Infinity;
  visited = false;
  edges: Edge[] = [];
  constructor(id: number, label: string) {
    this.id = id;
    this.label = label;
    logger.debug("vertex", this);
  }
  degree(): number {
    return this.edges.length;
  }
}
`,
    "edge.ts": `import { logger } from "./logger";
import type { Vertex } from "./vertex";

export class Edge {
  from: Vertex;
  to: Vertex;
  constructor(from: Vertex, to: Vertex) {
    this.from = from;
    this.to = to;
    logger.debug("edge", this);
  }
  cost(): number {
    return 1;
  }
}
export class WeightedEdge extends Edge {
  weight: number;
  constructor(from: Vertex, to: Vertex, weight: number) {
    super(from, to);
    this.weight = weight;
  }
  cost(): number {
    return this.weight;
  }
}
`,
    "graph.ts": `import { Edge, WeightedEdge } from "./edge";
import { logger } from "./logger";
import { Vertex } from "./vertex";

export class Graph {
  vertices = new Map<number, Vertex>();
  edgeCount = 0;
  constructor() {
    logger.debug("graph", this);
  }
  add(id: number, label: string): Vertex {
    const vertex = new Vertex(id, label);
    this.vertices.set(id, vertex);
    return vertex;
  }
  connect(from: Vertex, to: Vertex, weight?: number) {
    const edge = weight === undefined ? new Edge(from, to) : new WeightedEdge(from, to, weight);
    from.edges.push(edge);
    this.edgeCount++;
  }
  relax(start: Vertex): number {
    start.distance = 0;
    const queue = [start];
    let steps = 0;
    while (queue.length > 0) {
      const vertex = queue.shift()!;
      if (vertex.visited) continue;
      vertex.visited = true;
      for (const edge of vertex.edges) {
        const distance = vertex.distance + edge.cost();
        if (distance < edge.to.distance) edge.to.distance = distance;
        queue.push(edge.to);
        steps++;
      }
    }
    return steps;
  }
  farthest(): number {
    let most = 0;
    for (const vertex of this.vertices.values()) if (vertex.visited && vertex.distance > most) most = vertex.distance;
    return most;
  }
}
`,
    "main.ts": `import { Graph } from "./graph";

const graph = new Graph();
const vertices = [];
for (let i = 0; i < 8; i++) vertices.push(graph.add(i, "v" + i));
for (let i = 0; i + 1 < vertices.length; i++) graph.connect(vertices[i], vertices[i + 1], i % 2 ? i : undefined);
graph.connect(vertices[0], vertices[5], 9);
console.log(graph.relax(vertices[0]), graph.farthest(), vertices[0].degree(), graph.edgeCount);
`,
  };
}

describe("a logger that every constructor passes `this` to", () => {
  test("every class counts for the logger's call to console.log, and none is left once it prints no object", async () => {
    const [printed, notPrinted] = await Promise.all([
      explain(graphProgram("...values")),
      explain(graphProgram("values.length")),
    ]);
    const ofClasses = (causes: ExplainCause[]) =>
      causes.filter(cause => cause.types.length > 0 && cause.reason !== "missed-optimization");
    const atTheLogger = at(printed.causes, "logger.ts:11");
    expect({
      exitCodes: [printed.exitCode, notPrinted.exitCode],
      first: placeOf(printed.causes[0]),
      places: [...new Set(ofClasses(printed.causes).map(placeOf))],
      types: [...new Set(atTheLogger.flatMap(cause => cause.types))].sort(),
      left: ofClasses(notPrinted.causes).map(placeOf),
    }).toEqual({
      exitCodes: [0, 0],
      first: "logger.ts:11",
      places: ["logger.ts:11"],
      types: ["Edge", "Vertex", "WeightedEdge"],
      left: [],
    });
    const alone = sumOf(atTheLogger, cause => cause.fixedByThisAlone);
    expect(alone).toBeGreaterThanOrEqual(25);
    expect(alone).toBe(sumOf(atTheLogger, operationsOf));
    expect(printed.operations - notPrinted.operations).toBeGreaterThanOrEqual(alone);
  }, 120_000);
});
