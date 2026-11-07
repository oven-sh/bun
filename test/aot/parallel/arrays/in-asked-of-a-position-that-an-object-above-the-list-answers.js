// `index in list` where the list itself has no such element and an object above it has: a prototype that the list was given, before or between the walks, and the prototype of a class below Array.
const out = [];
function count(list, limit) {
  let present = 0,
    absent = 0,
    sum = 0;
  for (let k = 0; k < limit; k++) {
    if (k in list) {
      present++;
      sum += list[k];
    } else absent++;
  }
  return present + "/" + absent + "/" + sum;
}
function calls(list) {
  let n = 0;
  list.forEach(() => {
    n++;
  });
  return n;
}
class Padded extends Array {}
Object.defineProperty(Padded.prototype, 2, { value: 30, configurable: true });
const dense = [1, 2, 3],
  fractions = [0.5, 1.5],
  holes = [1, , 3],
  given = [1, 2],
  holesGiven = [0.5, , 2.5],
  padded = Padded.of(1, 2);
const all = () =>
  [
    count(dense, 6),
    count(fractions, 6),
    count(holes, 6),
    count(given, 6),
    count(holesGiven, 6),
    count(padded, 6),
    calls(holes),
    calls(holesGiven),
    calls(padded),
  ].join(" ");
out.push(all());
Object.setPrototypeOf(given, Object.create(Array.prototype, { 3: { value: 40 } }));
out.push(all());
Object.setPrototypeOf(
  holesGiven,
  Object.create(Array.prototype, {
    1: { value: 1.5 },
    4: {
      get() {
        return 4.5;
      },
    },
  }),
);
out.push(all());
padded.length = 4;
out.push(all());
Object.setPrototypeOf(given, Array.prototype);
delete Padded.prototype[2];
out.push(all());
console.log(out.join("\n"));
