export function append(list, value) {
  return list.push(value);
}

export function appendAll(list, values) {
  let last = "nothing";
  for (let i = 0; i < values.length; i++) {
    last = list.push(values[i]);
  }
  return last;
}

export function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

export function ends(list) {
  return [list[0], list[list.length - 1]];
}

export function sorted(list) {
  return list.sort();
}

export function kept(list) {
  return list.filter(item => item > 1);
}

export function walked(list) {
  const seen = [];
  for (const item of list) seen.push(item);
  return seen;
}
