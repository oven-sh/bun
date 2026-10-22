// Sources of a spread: `{ ...x }`, Object.assign and a rest pattern run the getters of the source, with the source as `this`, and copy what they return, which is a string under the type number.
let total = 0;

const raw: any = JSON.parse('{"width":"12"}');

class Frame {
  border = 1;
}

const source = {
  border: 2,
  get width(): number {
    total += typeof this.border === "number" ? 1 : 100;
    return raw.width;
  },
  get height(): number {
    total += 10000;
    return this.border * 2;
  },
};

function area(box: { width: number; height: number }): number | string {
  total += typeof box.width === "number" ? 1000000 : 100000000;
  return box.width + box.height;
}

const results = [area({ width: 1, height: 2 }), area({ ...source }), area(Object.assign(new Frame(), source)), area({ ...source, width: 3 })];
const { border, ...rest } = source;
results.push(area(rest), border);
console.log(total, results.join());
