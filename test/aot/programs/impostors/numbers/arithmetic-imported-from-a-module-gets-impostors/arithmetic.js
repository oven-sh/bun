export function add(a, b) {
  return a + b;
}

export function scale(value, factor) {
  return value * factor;
}

export function bucket(value) {
  return value & 15;
}

export const next = value => value + 1;

export let counter = 0;

export function bump() {
  return ++counter;
}

export function setCounter(value) {
  counter = value;
}
