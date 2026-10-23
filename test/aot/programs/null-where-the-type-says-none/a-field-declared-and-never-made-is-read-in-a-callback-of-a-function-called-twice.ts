class Inner {
  depth = 1;
}
class Point {
  declare inner: Inner;
}
function probe(v: Point) {
  const list = [v];
  [0].forEach(() => list[0].inner.depth);
  return "read";
}
function attempt() {
  try {
    console.log(probe(new Point()));
  } catch (error) {
    console.log((error as Error).name);
  }
}
attempt();
attempt();
