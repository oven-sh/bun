function outer(seed: number) {
  const base = () => seed * 2;
  const withDefault = (x: number = base()) => x + 1;
  const inPattern = ({ y = base() }: { y?: number } = {}) => y + 2;
  function declared(z: number = base()) { return z + 3; }
  return [withDefault(), withDefault(5), inPattern(), inPattern({ y: 1 }), declared(), declared(0)].join(",");
}
console.log(outer(10));
