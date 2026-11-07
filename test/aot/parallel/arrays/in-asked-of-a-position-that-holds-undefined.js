// `index in list` in front of `list[index]`: an element that is there and is undefined is there, whatever kind of storage the list has and however the undefined came into it.
const out = [];
{
  const made = [1, (() => {})(), 1];
  let absent = 0,
    sum = 0;
  for (let index = 0; index < 4; index++) {
    if (index in made) sum += made[index];
    else absent++;
  }
  out.push(sum + " " + absent);
}
{
  const made = [1, (() => {})(), 1];
  let present = 0,
    absent = 0;
  for (let index = 0; index < 4; index++) {
    if (index in made) present++;
    else absent++;
  }
  out.push(present + " " + absent);
}
{
  const made = [1.5, (() => {})(), 2.5];
  let isUndefined = 0,
    isNumber = 0,
    absent = 0;
  for (let index = 0; index < 4; index++) {
    if (index in made) {
      if (made[index] === undefined) isUndefined++;
      else isNumber++;
    } else absent++;
  }
  out.push(isUndefined + " " + isNumber + " " + absent);
}
function all(...given) {
  return given;
}
{
  const made = all(1, undefined, 2);
  let absent = 0,
    present = 0,
    sum = 0;
  for (let index = 0; index < made.length + 1; index++) {
    if (index in made) {
      present++;
      sum += made[index];
    } else absent++;
  }
  out.push(sum + " " + present + " " + absent);
}
function pair(x) {
  let sum = 0,
    absent = 0;
  const list = [1.5, x];
  for (let k = 0; k < 3; k++) {
    if (k in list) sum += list[k];
    else absent++;
  }
  return sum + "|" + absent;
}
out.push([pair(), pair(2.5), pair(undefined), pair(3)].join(" "));
function called(x) {
  let sum = 0,
    calls = 0;
  [1.5, x].forEach(value => {
    calls++;
    sum += value;
  });
  return sum + "|" + calls;
}
out.push([called(), called(2.5), called(undefined), called(3)].join(" "));
function count(list) {
  let present = 0,
    absent = 0,
    sum = 0;
  for (let k = 0; k < list.length; k++) {
    if (k in list) {
      present++;
      sum += list[k];
    } else absent++;
  }
  return present + "/" + absent + "/" + sum;
}
function methods(list) {
  let each = 0,
    map = 0,
    some = 0,
    every = 0,
    reduce = 0,
    filter = 0;
  list.forEach(() => {
    each++;
  });
  list.map(() => {
    map++;
  });
  list.some(() => {
    some++;
    return false;
  });
  list.every(() => {
    every++;
    return true;
  });
  list.reduce(total => {
    reduce++;
    return total;
  }, 0);
  list.filter(() => {
    filter++;
    return true;
  });
  return [each, map, some, every, reduce, filter].join("/");
}
for (let round = 0; round < 4; round++) {
  const fractions = [0.5, 1.5, 2.5];
  const integers = [1, 2, 3];
  const general = [];
  general.push(0.5);
  general.push(undefined);
  general.push(2.5);
  const withNaN = [0.5, NaN, 2.5];
  const holes = [0.5, , 2.5];
  const holesAmongIntegers = [1, , 3];
  const withUndefined = [0.5, (() => {})(), 2.5];
  const objects = [{}, undefined, {}];
  const holesAmongObjects = [{}, , {}];
  for (const list of [fractions, integers, general, withNaN, holes, holesAmongIntegers, withUndefined])
    out.push(count(list) + " " + methods(list));
  out.push(methods(objects) + " " + methods(holesAmongObjects));
}
console.log(out.join("\n"));
