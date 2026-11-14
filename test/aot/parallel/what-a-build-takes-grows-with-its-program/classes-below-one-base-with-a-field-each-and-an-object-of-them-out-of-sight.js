// SIZE classes extend one base, each declares one field of its own, and one object of them is given another prototype, which takes all of them out of sight: whoever holds an object finds its
// constructor, and Reflect.construct() may run one constructor for the class of another. So each class's field may come to the objects of every other class, and each such pair has a node of
// its own in the flow, three edges and a line in two tables: classes x classes, in memory too.
// It writes a program: SIZE says how large, PASSES how many copies of its classes under names of their own.
// Sizes: 200 400 800
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 1);
const out = [];
for (let copy = 0; copy < copies; copy++) {
  out.push(`class Base${copy} { tag = 0; }`);
  for (let at = 0; at < size; at++) out.push(`class Heir${copy}x${at} extends Base${copy} { own${copy}x${at} = ${at}; }`);
  out.push(`const all${copy}: Base${copy}[] = [${Array.from({ length: size }, (_, at) => `new Heir${copy}x${at}()`).join(", ")}];`);
  out.push(`Object.setPrototypeOf(all${copy}[0], Object.create(Heir${copy}x0.prototype));`);
  out.push(`console.log(all${copy}.length, all${copy}[0] instanceof Heir${copy}x0, all${copy}[0].tag);`);
}
console.log(out.join("\n"));
