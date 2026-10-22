const small = { name: 1 };
const large = { name: 2 };
const groups = Map.groupBy([1.5, 20.5], value => (value > 10 ? large : small));
console.log(groups.get(small)[0] + 1, groups.get(large)[0] + 1, [...groups.keys()][1].name + 1);
