// COUNT: arrivals <= 40
const hidden = (text: string) => text.split("~").join("");
const handBack = new Function("value", hidden("ret~urn value")) as <T>(value: T) => T;

function make() {
  return {
    get first() {
      return this.lead + 1;
    },
    get second() {
      return this.lead + this.width;
    },
    lead: 1,
    width: 2,
    depth: 3,
  };
}
const patched = Object.assign(make(), handBack({ lead: 2 }));
const keyed = make();
(keyed as any)[handBack("width")] = 4;

const all = [make(), patched, keyed];
let sum = 0;
for (let turn = 0; turn < 3000; turn++) {
  const one = all[turn % 3]!;
  sum += one.lead + one.width + one.depth + one.first + one.second;
}
console.log(sum, patched.first, keyed.second);
