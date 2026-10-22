const list = [1.5, 2.5, 3.5];
list.push(0.5, "text", null);
console.log(list.length, list.map(each => typeof each).join());
console.log(list[3] + 1, list[4].length, list[5] === null);
