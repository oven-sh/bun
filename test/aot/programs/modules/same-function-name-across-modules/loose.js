export function join(a, b) {
  return a + "-" + b;
}

export function pick(list, index) {
  return list[index];
}

export function tally() {
  let sum = 0;
  for (let i = 0; i < arguments.length; i++) sum += arguments[i];
  return sum;
}
