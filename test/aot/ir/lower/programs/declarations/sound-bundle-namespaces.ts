// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// A bundle of namespaces that hold both types and code: each is a variable that a function fills, beside a namespace of its types alone.
import { explain, far, util, type Loose } from "./bundle";

const loose: Loose = { x: 3 };
const point: util.P = { x: 3, y: 4 };
const key: util.deep.Key = "b";
console.log("through the functions:", far(point, key, 12), far({ x: 0, y: 0 }, "a", "abc"), explain("said"), explain({ message: "held" }), explain());
console.log("through the object:", util.dist(point), util.dist(point, { x: 3, y: 0 }), JSON.stringify(util.origin), util.deep.keys.join());
console.log("its keys:", Object.keys(util).join(), Object.keys(util.deep).join(), typeof util.dist, loose.x, loose.y);

// FILE: bundle.ts
// src/util.ts
namespace util {
export type MakePartial<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export interface P { x: number; y: number }
type Hidden = P | undefined;
export namespace deep {
export type Key = "a" | "b";
}
}
export type { Loose };
var util: any;
((util) => {
  type MakePartial<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
  interface P { x: number; y: number }
  type Hidden = P | undefined;
  util.origin = { x: 0, y: 0 };
  function dist(a: P, b: Hidden = util.origin): number {
    return Math.hypot(a.x - (b?.x ?? 0), a.y - (b?.y ?? 0));
  }
  util.dist = dist;
  let deep;
  ((deep) => {
    type Key = "a" | "b";
    deep.keys = ["a", "b"];
  })(deep = util.deep ||= {});
})(util ||= {});
namespace onlyTypes {
  export type Id = string | number;
}
namespace errors {
export type Message = string | { message?: string };
}
var errors: any;
((errors) => {
  type Message = string | { message?: string };
  errors.toObject = (message?: Message): { message?: string } => typeof message === "string" ? { message } : message || {};
})(errors ||= {});

// src/index.ts
type Loose = util.MakePartial<util.P, "y">;
function far(point: util.P, key: util.deep.Key, id: onlyTypes.Id): number {
  return util.dist(point) + util.deep.keys.indexOf(key) + String(id).length;
}
function explain(message?: errors.Message): string | undefined {
  return errors.toObject(message).message;
}
export {
  explain,
  far,
  util
};

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
