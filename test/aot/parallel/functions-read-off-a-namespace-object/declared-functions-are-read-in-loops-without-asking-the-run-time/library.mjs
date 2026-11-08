export function isWordCharacter(code) {
  if (code >= 97 && code <= 122) return true;
  if (code >= 65 && code <= 90) return true;
  if (code >= 48 && code <= 57) return true;
  return code === 95;
}
export async function later(value) {
  return value + 1;
}
export function* upTo(limit) {
  for (let i = 0; i < limit; i++) yield i;
}
export class Counter {
  count = 0;
  step() {
    return ++this.count;
  }
}
export const arrow = code => code === 95;
export function swapped() {
  return "as declared";
}
export function swap() {
  swapped = function () {
    return "as stored";
  };
}
export function counted() {
  counted.calls = (counted.calls ?? 0) + 1;
  return counted.calls;
}
