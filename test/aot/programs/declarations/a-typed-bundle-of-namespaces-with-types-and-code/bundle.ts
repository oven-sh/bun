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
