declare const FIXED: unknown, KIND: unknown, SHADE: unknown;
namespace Space {
  (globalThis as any).seen = [FIXED, typeof KIND, SHADE].join(", ");
  throw "the namespace has thrown";
  const fixed = 1;
  class Kind {}
  enum shade {
    Dark,
  }
}
export {};
