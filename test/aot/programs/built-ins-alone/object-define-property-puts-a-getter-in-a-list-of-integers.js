const list = [1, 2, 3];
Object.defineProperty(list, 1, {
  get() {
    return "text";
  },
});
console.log(list.length, list.map(each => typeof each).join());
console.log(list[1].length);
let total = 0;
for (const each of list) total += each;
console.log(total);
