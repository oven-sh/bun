// The parent comes out of a list, and each of the three is taken once.
class P { k() { return 1; } }
class Q { k() { return 2; } }
class R { k() { return 3; } }
for (const n of [0, 1, 2]) {
  class B extends [P, Q, R][n] {}
  const derive = (c) => class extends c {};
  console.log(new (derive(B))().k());
}
