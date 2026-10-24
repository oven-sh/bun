export const Lazy = { a: 1, b: 2 };
export const LazyByKey = { a: 100, b: 200 };
export const LazyUntouched = { a: 1000, b: 2000 };
export function readLazy() {
  return Lazy.a + LazyByKey.a + LazyUntouched.a;
}
