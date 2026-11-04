function atOnce() {
  try {
    const f: () => number = (() => f())() as unknown as () => number;
    return typeof f;
  } catch (e) { return (e as Error).name; }
}
function inAnArgument() {
  const id = <T,>(x: T) => x;
  try {
    const g: () => number = id(g!);
    return typeof g;
  } catch (e) { return (e as Error).name; }
}
console.log(atOnce(), inAnArgument());
