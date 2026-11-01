// concat of a list of numbers and a list of anything, in either order, with holes, zeros of both signs and values that are no lists.
const join = (first, ...rest) => first.concat(...rest);
const joinOne = (first, second) => first.concat(second);
const describe = list => {
  const parts = [];
  for (let i = 0; i < list.length; i++) parts.push(i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] + ":" + String(list[i])) : "hole");
  return list.length + " [" + parts.join(" ") + "]";
};
const fractions = () => [1.5, 2.5, -0, 0, Infinity];
const fractionsWithHoles = () => { const list = [0.5, , 2.5, ,]; return list; };
const fractionsWithNaN = () => [0.5, NaN, 1.5];
const wholes = () => [1, 2, 3];
const anything = () => ["a", 1, null, undefined, { toString() { return "object"; } }];
const anythingWithHoles = () => ["a", , "c"];
const empty = () => [];
const long = () => { const list = []; for (let i = 0; i < 300; i++) list.push(i + 0.25); return list; };
const makers = { fractions, fractionsWithHoles, fractionsWithNaN, wholes, anything, anythingWithHoles, empty };
const lines = [];
for (let round = 0; round < 2; round++) {
  for (const [first, makeFirst] of Object.entries(makers)) {
    for (const [second, makeSecond] of Object.entries(makers)) {
      lines.push(first + " + " + second + ": " + describe(joinOne(makeFirst(), makeSecond())));
      lines.push(first + " + " + second + " + fractions: " + describe(join(makeFirst(), makeSecond(), fractions())));
      lines.push(first + " + text + " + second + ": " + describe(join(makeFirst(), "text", makeSecond())));
      lines.push(first + " + 0.5 + " + second + ": " + describe(join(makeFirst(), 0.5, makeSecond())));
    }
  }
}
const joined = joinOne(anything(), long());
lines.push("long: " + joined.length + " " + joined[4] + " " + joined[5] + " " + joined[304]);
const source = fractions();
const copy = joinOne(["x"], source);
source[0] = 9.5;
copy[2] = "changed";
lines.push("apart: " + describe(source) + " | " + describe(copy));
console.log(lines.join("\n"));
