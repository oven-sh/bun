import * as measure from "../measure.js";
import { area, perimeter, scaled, widest } from "../measure.js";

export const log = [];
const boxes = {
  texts: () => ({ width: "3", height: "4" }),
  otherOrder: () => ({ height: 4, width: 3 }),
  extraMembers: () => ({ depth: 1, width: 3, name: "box", height: 4 }),
  getters: () => ({
    get width() {
      log.push("width");
      return 3;
    },
    get height() {
      log.push("height");
      return 4;
    },
  }),
  changingGetter: () => {
    let reads = 0;
    return {
      get width() {
        return ++reads;
      },
      height: 4,
    };
  },
  inherited: () => Object.create({ width: 3, height: 4 }),
  proxy: () =>
    new Proxy(
      {},
      {
        get(target, key) {
          log.push("get " + String(key));
          return key === "width" ? 3 : 4;
        },
      },
    ),
  missingHeight: () => ({ width: 3 }),
  big: () => ({ width: 3n, height: 4n }),
  mixedBig: () => ({ width: 3n, height: 4 }),
  objects: () => ({ width: { valueOf: () => (log.push("valueOf width"), 3) }, height: { valueOf: () => (log.push("valueOf height"), 4) } }),
  list: () => [3, 4],
  text: () => "box",
  nothing: () => null,
  aFunction: () => Object.assign(function box() {}, { width: 3, height: 4 }),
};

export function seen(name) {
  const box = boxes[name]();
  return [area(box), perimeter(box), scaled(box, 2), widest([box, { width: 2, height: 2 }]) === box];
}
export function halfSeen(name) {
  const box = boxes[name]();
  return [area.call(null, box), perimeter.apply(null, [box]), scaled.bind(null, box)(2), [[box, { width: 2, height: 2 }]].map(widest)[0] === box];
}
export function unseen(name) {
  const box = boxes[name]();
  const call = new Function("measure", "name", "operands", "return measure[name](...operands)");
  return [call(measure, "area", [box]), call(measure, "perimeter", [box]), call(measure, "scaled", [box, 2]), call(measure, "widest", [[box, { width: 2, height: 2 }]]) === box];
}
export const names = Object.keys(boxes);
