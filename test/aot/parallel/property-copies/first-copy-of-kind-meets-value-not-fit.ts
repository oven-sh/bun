// The first copy between two kinds of record finds a value that the field of the target does not take in its slot, and the copies after it find values that fit.
// What the first one learned before it gave up must not be taken for what a whole copy leaves behind. Nothing here is in a loop, so no copy is expanded where it stands.
type Point = { x: number; y: number }
type Options = { a?: number; b?: number | string; c?: string }
function show(label: string, copy: object): void {
  console.log(label, JSON.stringify(copy), Object.keys(copy).join(","), Object.is((copy as { y?: unknown }).y, -0), Object.is((copy as { x?: unknown }).x, -0));
}
function withStores(point: Point, y: number, z: number): object { return { ...point, y, z }; }
function behind(point: Point, z: number): object { return { z, ...point }; }
function alone(point: Point, z: number): { x: number; y: number; z?: number; w?: number } { return { ...point, w: z }; }
function options(from: Options, d: number): Options & { d: number } { return { d, ...from }; }

show("stores, minus zero", withStores({ x: 0, y: -0 }, 10, 20));
show("stores", withStores({ x: 1, y: -1 }, 10, 20));
show("stores", withStores({ x: 2, y: -2 }, 10, 20));
show("stores, a fraction", withStores({ x: 2.5, y: 1e300 }, 10, 20));
show("stores", withStores({ x: 3, y: -3 }, 10, 20));

show("behind, minus zero", behind({ x: -0, y: 0 }, 1));
show("behind", behind({ x: 1, y: 2 }, 1));
show("behind, not a number", behind({ x: NaN, y: Infinity }, 1));
show("behind", behind({ x: 3, y: 4 }, 1));

show("alone, large", alone({ x: 2 ** 31, y: -(2 ** 31) - 1 }, 1));
show("alone", alone({ x: 1, y: 2 }, 1));
show("alone, minus zero", alone({ x: -0, y: -0 }, 1));
show("alone", alone({ x: 3, y: 4 }, 1));

show("options, text", options({ a: 1, b: "text" }, 1));
show("options", options({ a: 1, b: 2 }, 1));
show("options, a fraction", options({ a: 0.5, b: 2 }, 1));
show("options", options({ a: 3, b: 4 }, 1));
show("options, another order", options({ b: 4, a: 3 }, 1));
show("options, another order", options({ b: "t", a: -0 }, 1));
show("options, another order", options({ b: 5, a: 6, c: "c" }, 1));
