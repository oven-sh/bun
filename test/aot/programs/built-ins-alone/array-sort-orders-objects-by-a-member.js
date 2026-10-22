const list = [{ rank: 2.5, name: "b" }, { rank: 1.5, name: "a" }];
list.sort((left, right) => left.rank - right.rank);
console.log(list[0].name, list[1].rank + 1);
