// Held from creation: map, filter, slice, splice, concat and flat read `constructor` from an instance and construct the class with a number, while every `new` in the program passes a string.
class Labeled extends Array<number> {
  label: string;
  constructor(label: string) {
    super();
    this.label = typeof label === "string" ? label : "native " + typeof label + " " + (label + 1);
  }
}

const list = new Labeled("mine");
list.push(1, 2, 3);
const made = [
  list.map(x => x * 2),
  list.filter(x => x > 1),
  list.slice(1),
  list.concat([4]),
  list.flat(),
  list.flatMap(x => [x, x]),
  list.splice(0, 2),
] as Labeled[];
console.log(made.map(one => one.label + "/" + one.length + "/" + (one instanceof Labeled)).join(" "));
