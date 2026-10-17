type Kind = Kind3;
declare namespace Kind { export type Leaf = Kind3.Leaf; export type Branch = Kind3.Branch; }
type Color = Color3;
declare namespace Color { export type Red = Color3.Red; export type Blue = Color3.Blue; }
declare const KEY2: unique symbol;
declare const OTHER2: unique symbol;
declare const exports_keys2: { COUNT: typeof COUNT; Color: typeof Color; KEY: typeof KEY; Kind: typeof Kind; NAME: typeof NAME; NIL: typeof NIL; NOTHING: typeof NOTHING; OTHER: typeof OTHER; Unused: typeof Unused; used: typeof used };
export type { Marked };
export type { Tools };
export type { Tree };
var __defProp = Object.defineProperty;
var __returnValue = (v: any) => v;
function __exportSetter(this: any, name: any, newValue: any) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target: any, all: any) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/keys.ts
var exports_keys: any = {};
__export(exports_keys, {
  COUNT: () => COUNT,
  Color: () => Color,
  KEY: () => KEY,
  Kind: () => Kind,
  NAME: () => NAME,
  NIL: () => NIL,
  NOTHING: () => NOTHING,
  OTHER: () => OTHER,
  Unused: () => Unused,
  used: () => used
});
var KEY: typeof KEY2 = Symbol.for("key") as typeof KEY2;
var OTHER: typeof OTHER2 = Symbol("other") as typeof OTHER2;
var NAME = "name" as const;
var COUNT = -3 as const;
var NIL: undefined = undefined;
var NOTHING: null = null;
var Kind!: typeof Kind3;
((Kind2: any) => {
  Kind2[Kind2["Leaf"] = 0] = "Leaf";
  Kind2[Kind2["Branch"] = 1] = "Branch";
})(Kind ||= {} as any);
declare enum Kind3 { Leaf, Branch }
declare enum Color3 { Red = "red", Blue = "blue" }
var Color!: typeof Color3;
((Color2: any) => {
  Color2["Red"] = "red";
  Color2["Blue"] = "blue";
})(Color ||= {} as any);

abstract class Unused {
abstract run(): void
}
function used(): number {
  return COUNT;
}

// src/index.ts
declare const injected: number;
interface Marked { [KEY]?: boolean; [OTHER]: number; name: string }
type Tools = { Unused: typeof Unused; used: typeof used };
interface Leaf { kind: Kind3.Leaf; value: number }
interface Branch { kind: Kind3.Branch; left: Tree; right: Tree }
type Tree = Leaf | Branch;
function sum(tree: Tree): number {
  switch (tree.kind) {
    case 0 as Kind3.Leaf /* Leaf */:
      return tree.value;
    case 1 as Kind3.Branch /* Branch */:
      return sum(tree.left) + sum(tree.right);
  }
}
function leaf(value: number): Tree {
  return { kind: 0 as Kind3.Leaf /* Leaf */, value };
}
function paint(color: Color3 = "red" as Color3.Red /* Red */): Color3 {
  return color === ("blue" as Color3.Blue) /* Blue */ ? "red" as Color3.Red /* Red */ : "blue" as Color3.Blue as Color3 /* Blue */;
}
function mark(target: object, name: unknown): Marked {
  const marked = target as Marked;
  (target as { [KEY]?: boolean })[KEY] = true;
  marked[OTHER] = used() + injected;
  const record: Record<typeof NAME, string> = { [NAME]: "x" };
  return { name: name as string, [OTHER]: record[NAME].length, [KEY]: NIL ?? NOTHING ?? undefined };
}
function pick(name: keyof typeof exports_keys2): unknown {
  return exports_keys[name];
}
function depth(tree: Tree, flag: number): number {
  const first = tree.kind === (1 as Kind3.Branch) /* Branch */ ? +flag : -flag;
  return first + (flag & (1 as Kind3.Branch) /* Branch */ | flag);
}

class Machine {
  state: Kind3 = 0 as Kind3.Leaf /* Leaf */;
  readonly first = 0 as Kind3.Leaf /* Leaf */;
  step(next: Color3 = "red" as Color3.Red /* Red */): Kind3 {
    let color: Color3 = "blue" as Color3.Blue /* Blue */;
    color = next;
    this.state = color === ("red" as Color3.Red) /* Red */ ? 1 as Kind3.Branch /* Branch */ : 0 as Kind3.Leaf /* Leaf */;
    return this.state;
  }
}
export {
  Machine,
  depth,
  exports_keys as everything,
  leaf,
  mark,
  paint,
  pick,
  sum
};

