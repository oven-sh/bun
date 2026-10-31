// A method and an accessor that a generic function writes behind a spread of its parameter get fields in the layout of what arrives: no type is opened for them.
// IR- ^layout (?!.*IsNeverAllocated)(?!.*impossibleMutations=\[[^\]]*AddProperty)
interface Named {
  name: string;
}
interface Point extends Named {
  x: number;
}
function dress<T extends Named>(value: T) {
  return {
    ...value,
    greet() {
      return "hello " + this.name;
    },
    get size() {
      return this.name.length;
    },
    set size(length: number) {
      this.name = this.name.slice(0, length);
    },
  };
}
for (let round = 0; round < 3; round++) {
  const point: Point = { name: "point" + round, x: round };
  const dressed = dress<Point>(point);
  console.log(dressed.greet(), dressed.size, dressed.x, Object.keys(dressed).join(), JSON.stringify(dressed));
  dressed.size = 2;
  console.log(dressed.name, dressed.size, point.name, Object.keys(point).join(), "size" in point, "greet" in point);
  console.log(
    JSON.stringify(Object.getOwnPropertyDescriptor(dressed, "size")),
    typeof Object.getOwnPropertyDescriptor(dressed, "size")!.get,
  );
}
