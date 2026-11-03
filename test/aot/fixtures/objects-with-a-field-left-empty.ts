// Objects with a field that most of them leave empty, and the reads, tests and stores that meet the empty field. For the programs of names-that-come-above-objects: each of them
// puts the name above the objects in a way of its own between two calls of round(), which prints what the same code finds each time.
export interface Leaf {
  x: number;
  y: number;
}
export interface Options {
  a: number;
  late?: Leaf;
}
export class Point {
  a: number;
  declare late?: Leaf;
  constructor(a: number) {
    this.a = a;
  }
}
export class Point3 extends Point {
  z = 3;
}
export function Old(this: any, a: number) {
  this.a = a;
  if (a % 4 === 0) this.late = { x: a, y: 1 };
}

const count = 40;

export function makeOptions(a: number): Options {
  return a % 4 === 0 ? { a, late: { x: a, y: 1 } } : { a };
}
export function makePoint(a: number): Point {
  const point = a % 2 ? new Point(a) : new Point3(a);
  if (a % 4 === 0) point.late = { x: a, y: 1 };
  return point;
}
export function makeOld(a: number): Options {
  return new (Old as any)(a);
}

// A maker stores the name into every fourth object, and what lies above may refuse the store.
function listOf<T>(make: (a: number) => T): T[] {
  const list: T[] = [];
  for (let a = 0; a < count; a++) {
    try {
      list.push(make(a));
    } catch {}
  }
  return list;
}

export const options = listOf(makeOptions);
export const points = listOf(makePoint);
export const olds = listOf(makeOld);

function readOptions(list: Options[]): string {
  let total: unknown = 0;
  let empty = 0;
  let found = 0;
  for (const object of list) {
    const late = object.late;
    if (late === undefined) empty++;
    else total = (total as number) + late.x + late.y;
    if ("late" in object) found++;
  }
  return `${total} ${empty} ${found}`;
}
function readPoints(list: Point[]): string {
  let total: unknown = 0;
  let empty = 0;
  let found = 0;
  for (const object of list) {
    const late = object.late;
    if (late === undefined) empty++;
    else total = (total as number) + late.x + late.y;
    if ("late" in object) found++;
  }
  return `${total} ${empty} ${found}`;
}
function readThroughChain(list: Point[]): string {
  let text = "";
  for (const object of list) text += object.late?.x ?? "-";
  return text;
}

function storeIntoOptions(list: Options[]): number {
  let own = 0;
  for (const object of list) {
    object.late = { x: 100, y: 1 };
    if (Object.hasOwn(object, "late")) own++;
  }
  return own;
}
function storeIntoPoints(list: Point[]): number {
  let own = 0;
  for (const object of list) {
    object.late = { x: 100, y: 1 };
    if (Object.hasOwn(object, "late")) own++;
  }
  return own;
}
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

/** Built-in objects are read-only in an executable, so what a program tries on one of them says how it went. */
export function tried(label: string, run: () => unknown) {
  console.log(`${label}: ${attempt(() => (run(), "done"))}`);
}

export function round(label: string) {
  console.log(label);
  console.log("  literals made before:", attempt(() => readOptions(options)));
  console.log("  literals made now:", attempt(() => readOptions(listOf(makeOptions))));
  console.log("  instances made before:", attempt(() => readPoints(points)), attempt(() => readThroughChain(points)));
  console.log("  instances made now:", attempt(() => readPoints(listOf(makePoint))));
  console.log("  objects of a function made before:", attempt(() => readOptions(olds)));
  console.log("  objects of a function made now:", attempt(() => readOptions(listOf(makeOld))));
  const stored = [listOf(makeOptions), listOf(makeOld)];
  const storedPoints = listOf(makePoint);
  console.log("  stores:", attempt(() => storeIntoOptions(stored[0])), attempt(() => storeIntoOptions(stored[1])), attempt(() => storeIntoPoints(storedPoints)));
  console.log("  behind the stores:", attempt(() => readOptions(stored[0])), "|", attempt(() => readOptions(stored[1])), "|", attempt(() => readPoints(storedPoints)));
}
