// Closures made in a callback that call hands to a built in.
const like = { length: 3, 0: 1, 1: 2, 2: 3 };
const made = [];
Array.prototype.forEach.call(like, function (item) {
  let count = item * 10;
  made.push(() => ++count);
});
console.log(made.map(one => one()).join(), made.map(one => one()).join(), new Set(made).size);
const kept = Array.prototype.map.call(like, function (item) {
  function named() { return item; }
  named.mark = item;
  return named;
});
console.log(kept.map(one => one() + ":" + one.mark).join(), kept[0] === kept[1]);
const byApply = [];
Array.prototype.filter.apply([4, 5, 6], [function (item) { byApply.push({ get: () => item }); return true; }]);
console.log(byApply.map(one => one.get()).join());
const byReflect = [];
Reflect.apply(Array.prototype.some, [7, 8, 9], [function (item) { byReflect.push(class { static value = item; }); return false; }]);
console.log(byReflect.map(one => one.value).join(), byReflect[0] === byReflect[2]);
