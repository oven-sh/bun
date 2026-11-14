// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// A project with paths packages and declaration files honest.
import { scaled } from "@/scale";
import settings from "#settings";
import { Counter, limit, origin, plusOne } from "legacy";
import { Pixel, type Point, sum } from "shapes";

let total = 0;
const points: Point[] = [];
const counter = new Counter(0);
for (let i = 0; i < 2000; i++) {
  const p = new Pixel(i, 1);
  points.push(scaled(p));
  total += p.sum() + sum(p) + sum(origin()) + plusOne(i) + counter.next() + limit + settings.scale;
}
for (const p of points) total += p.x + p.y;
console.log("total: " + total);
console.log("counter: " + counter.n + " " + JSON.stringify(counter));
console.log("last: " + JSON.stringify(points[points.length - 1]) + " " + settings.name + " " + Object.keys(origin()).join());

// FILE: package.json
{
  "name": "honest-app",
  "type": "module",
  "imports": {
    "#settings": "./src/settings.json"
  }
}

// FILE: packages/legacy/index.d.ts
export declare function plusOne(n: number): number;
export declare function origin(): { x: number; y: number };
export declare class Counter {
  n: number;
  constructor(start: number);
  next(): number;
}
export declare const limit: number;

// FILE: packages/legacy/index.js
export function plusOne(n) {
  return n + 1;
}

export function origin() {
  return { x: 0, y: 0 };
}

export class Counter {
  constructor(start) {
    this.n = start;
  }
  next() {
    return ++this.n;
  }
}

export const limit = 10;

// FILE: packages/shapes/index.ts
export interface Point {
  x: number;
  y: number;
}

export class Pixel implements Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

export function sum(p: Point): number {
  return p.x + p.y;
}

// FILE: src/scale.ts
import settings from "#settings";
import type { Point } from "shapes";

export function scaled(p: Point): Point {
  return { x: p.x * settings.scale + settings.offset.x, y: p.y * settings.scale + settings.offset.y };
}

// FILE: src/settings.json
{ "scale": 2, "name": "honest", "offset": { "x": 1, "y": 2 } }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "paths": { "shapes": [ "./packages/shapes/index.ts" ], "legacy": [ "./packages/legacy/index" ], "@/*": [ "./src/*" ] } }, "files": [] }
