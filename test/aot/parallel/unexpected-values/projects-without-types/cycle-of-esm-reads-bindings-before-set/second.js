import { Shape, count, hoisted, list, old, readsTheList } from "./first.js";
import { show } from "./show.js";

function tried(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}
const sizeOfList = () => list.length;
const nextCount = () => count + 1;
const sizeOfOld = () => old.length;
const oldPlusOne = () => old + 1;
const sides = () => new Shape().sides();
const typeOfCount = () => typeof count;

export function look() {
  return {
    list: tried(sizeOfList),
    count: tried(nextCount),
    typeOfCount: tried(typeOfCount),
    sizeOfOld: tried(sizeOfOld),
    oldPlusOne: tried(oldPlusOne),
    sides: tried(sides),
    hoisted: tried(hoisted),
    readsTheList: tried(readsTheList),
  };
}
export const early = look();
