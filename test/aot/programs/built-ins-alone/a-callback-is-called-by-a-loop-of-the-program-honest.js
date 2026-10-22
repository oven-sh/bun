function each(list, callback, self) {
  for (let index = 0; index < list.length; index++) callback.call(self, list[index], index, list);
}
const list = [1.5, "two"];
each(list, function (value, index, whole) {
  console.log(typeof value, value, index + 1, whole === list, this === undefined, arguments.length);
});
