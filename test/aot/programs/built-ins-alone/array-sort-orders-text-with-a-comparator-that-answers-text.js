const list = ["b", "a"];
list.sort((left, right) => (left < right ? "-1" : "1"));
console.log(list.join());
