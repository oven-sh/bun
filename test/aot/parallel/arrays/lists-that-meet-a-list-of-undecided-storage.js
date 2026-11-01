// A list given a NaN is read where a slice of it also arrives: a reader may change how such a list is stored.
function around(list) {
  let most = -Infinity;
  [list, list.slice()].forEach(row => {
    row.forEach(each => {});
  });
  list.flatMap((each, at) => {
    most = each > most ? each : most;
    if (at === 1) list.push(NaN);
  });
  return most;
}
console.log(around([1, 3, 7, 2]));
console.log(around([1, 7, 2]));
console.log(around([7]));
console.log(around([1.5, 7, 2]));

function total(list) {
  let sum = 0;
  [list, list.concat([4])].forEach(row => {
    row.forEach(each => {});
  });
  list.map((each, at) => {
    sum += each;
    if (at === 0) list.push(Infinity);
  });
  return sum;
}
console.log(total([1, 2, 3]));
console.log(total([6, 5]));

function read(list) {
  for (const row of [list, list.slice()])
    for (const each of row) {
    }
  list.forEach((each, at) => {
    if (at === 0) list[1] = "text";
  });
  return list.join();
}
console.log(read([1, 2, 3]));
console.log(read([4, 5]));

function withUndefined(list) {
  let most = -Infinity;
  [list, list.slice()].forEach(row => {
    row.forEach(each => {});
  });
  list.flatMap((each, at) => {
    most = each > most ? each : most;
    if (at === 1) list.push(undefined);
  });
  return most;
}
console.log(withUndefined([1, 3, 7, 2]));
console.log(withUndefined([1, 7, 2]));
console.log(withUndefined([1, , 7, 2]));
console.log(withUndefined([, 7, 2]));

function copied(list, at) {
  const copy = Array.from(list);
  return [copy[at], copy.length, copy.join()];
}
console.log(copied([1, 2, , 4], 2));
console.log(copied([1, 2, , 4], 3));
console.log(copied([1.5, , 4], 0));
