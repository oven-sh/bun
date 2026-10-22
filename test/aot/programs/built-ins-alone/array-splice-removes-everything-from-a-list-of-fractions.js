const list = [1.5, 2.5, 3.5];
const removed = list.splice(0);
console.log(list.length, list.map(each => typeof each).join());
console.log(removed.length, removed[2] + 1, list[0] === undefined);
