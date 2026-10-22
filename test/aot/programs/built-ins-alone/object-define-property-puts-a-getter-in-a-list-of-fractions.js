const list = [1.5, 2.5, 3.5];
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
