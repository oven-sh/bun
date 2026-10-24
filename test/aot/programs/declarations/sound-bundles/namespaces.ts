type Boxed = Box<number>;
type Color = Color3;
declare namespace Color { export type Red = Color3.Red; export type Blue = Color3.Blue; }
declare const KEY2: unique symbol;
declare namespace exports_keys { export type { Boxed }; }
declare const exports_keys2: { Box: typeof Box; Color: typeof Color; KEY: typeof KEY; NAME: typeof NAME; used: typeof used };
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
  Box: () => Box,
  Color: () => Color,
  KEY: () => KEY,
  NAME: () => NAME,
  used: () => used
});
var NAME = "name" as const;
var KEY: typeof KEY2 = Symbol.for("key") as typeof KEY2;
declare enum Color3 { Red = "red", Blue = "blue" }
var Color!: typeof Color3;
((Color2: any) => {
  Color2["Red"] = "red";
  Color2["Blue"] = "blue";
})(Color ||= {} as any);
function used(): number {
  return NAME.length;
}

class Box<T> {
  public value: T;
  constructor(value: T) {
    this.value = value;
  }
  get(): T {
    return this.value;
  }
}

// src/index.ts
function pick(name: keyof typeof exports_keys2): unknown {
  return exports_keys[name];
}
function box(value: number): Boxed {
  const made = new Box(value);
  (made as { [KEY]?: boolean })[KEY] = true;
  return made;
}
function names(): string[] {
  return Object.keys(Color).concat(Object.keys(exports_keys));
}
export {
  box,
  exports_keys as everything,
  names,
  pick
};

