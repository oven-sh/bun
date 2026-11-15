// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

// FILE: main.ts
// Imports used only as types under verbatim module syntax.
import { log } from "./log";
import type { Shape as A } from "./whole-type";
import { type Shape as B } from "./inline-type";
import { type Model as C, type Shape as D } from "./named-type";
import type E from "./default-type";
import { type Shape as F, value } from "./mixed";
import type * as G from "./namespace-type";
import type { Shape as H } from "./again";
import "./bare";
import { value as neverUsed } from "./unused-value";
import NeverUsed from "./unused-default";
import * as neverUsedEither from "./unused-namespace";
import { Model } from "./used";

const a: A = { sides: 1 };
const b: B = { sides: 2 };
const c: C = { sides: 3 };
const d: D = { sides: 4 };
const e: E = { name: "e" };
const f: F = { sides: 6 };
const g: G.Shape = { sides: 7 };
const h: H = { sides: 8 };

console.log("modules that ran: " + log.join(", "));
console.log([a.sides, b.sides, c.sides, d.sides, e.name, f.sides, g.sides, h.sides, value, new Model().sides].join(" "));
console.log("c is a Model of another module: " + (c instanceof Model));

// FILE: again.ts
import { log } from "./log";

log.push("again ran");

export type { Shape } from "./exported-again";
export { type Model } from "./exported-again";

// FILE: bare.ts
import { log } from "./log";

log.push("bare ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "bare";

export default class Main {
  name = "bare";
}

// FILE: default-type.ts
import { log } from "./log";

log.push("default-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "default-type";

export default class Main {
  name = "default-type";
}

// FILE: exported-again.ts
import { log } from "./log";

log.push("exported-again ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "exported-again";

export default class Main {
  name = "exported-again";
}

// FILE: inline-type.ts
import { log } from "./log";

log.push("inline-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "inline-type";

export default class Main {
  name = "inline-type";
}

// FILE: log.ts
export const log: string[] = [];

// FILE: mixed.ts
import { log } from "./log";

log.push("mixed ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "mixed";

export default class Main {
  name = "mixed";
}

// FILE: named-type.ts
import { log } from "./log";

log.push("named-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "named-type";

export default class Main {
  name = "named-type";
}

// FILE: namespace-type.ts
import { log } from "./log";

log.push("namespace-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "namespace-type";

export default class Main {
  name = "namespace-type";
}

// FILE: unused-default.ts
import { log } from "./log";

log.push("unused-default ran");

export const value = "unused-default";

export default class Main {
  name = "unused-default";
}

// FILE: unused-namespace.ts
import { log } from "./log";

log.push("unused-namespace ran");

export const value = "unused-namespace";

export default class Main {
  name = "unused-namespace";
}

// FILE: unused-value.ts
import { log } from "./log";

log.push("unused-value ran");

export const value = "unused-value";

export default class Main {
  name = "unused-value";
}

// FILE: used.ts
import { log } from "./log";

log.push("used ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "used";

export default class Main {
  name = "used";
}

// FILE: whole-type.ts
import { log } from "./log";

log.push("whole-type ran");

export interface Shape {
  sides: number;
}

export class Model {
  sides = 4;
}

export const value = "whole-type";

export default class Main {
  name = "whole-type";
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "verbatimModuleSyntax": true }, "files": [] }
