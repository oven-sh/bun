// A conditional yields a literal with members or an empty one, and a function stores into the result under a key that arrives from outside. Other values of the same functions are declared and arrive from outside too.
function fill(target: any, key: string) {
  target[key] = 1;
  return target;
}
function namesUpTo(count: number): string[] {
  const names: string[] = [];
  for (let index = 0; index < count; index++) names.push("n" + index);
  return names;
}

function listedOrEmpty(count: number, key: string, label: string) {
  const list = namesUpTo(count & 3);
  const body = list.length > 0 ? { names: list } : {};
  return label.length + JSON.stringify(fill(body, key));
}

function emptiedLike(value: unknown, key: string) {
  const made = !Array.isArray(value)
    ? Object.keys(value as object).length === 0
      ? {}
      : { held: undefined }
    : value.length === 0
      ? []
      : [undefined];
  return JSON.stringify(fill(made, key)) + Object.keys(made).join();
}

const given: any = JSON.parse('[2, 0, "k", "z", "label", ["a"], [], { "a": 1 }, {}]');
console.log(listedOrEmpty(given[0], given[2], given[4]), listedOrEmpty(given[1], given[3], given[4]));
for (const value of given.slice(5)) {
  console.log(emptiedLike(value, given[2]), emptiedLike(value, given[3]));
}
