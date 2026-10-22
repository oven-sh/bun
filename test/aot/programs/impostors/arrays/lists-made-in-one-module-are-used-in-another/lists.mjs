class Loud extends Array {
  push() {
    return "the subclass's push";
  }
  map() {
    return "the subclass's map";
  }
  forEach() {
    return "the subclass's forEach";
  }
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

export const honest = () => [3, 1, 2];
export const arrayLike = () => ({ 0: 3, 1: 1, 2: 2, length: 3 });
export const subclass = () => Loud.of(3, 1, 2);
export const text = () => "312";
export const frozen = () => Object.freeze([3, 1, 2]);
export const proxy = () => new Proxy([3, 1, 2], {});
export const holes = () => [3, , 2];
export const doubles = () => [3.5, 1.5, 2.5];

export let current = [1, 2, 3];
export function replaceCurrent(value) {
  current = value;
  return [];
}
