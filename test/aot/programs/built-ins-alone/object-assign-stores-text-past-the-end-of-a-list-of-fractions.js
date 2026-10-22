const list = [1.5, 2.5, 3.5];
Object.assign(list, { 5: "text" });
console.log(list.length, 4 in list, list[4] === undefined, list[5].length);
