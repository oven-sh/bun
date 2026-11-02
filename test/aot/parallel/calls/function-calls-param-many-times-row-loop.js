// A function calls its second parameter eighteen times in a row, each time with an element of a short list and a number, and then once for every element in a loop.
// It is called with functions that read `arguments` and with arrows that take both operands.
function each(list, f) {
  let out = 0;
  out += f(list[0], 0);
  out += f(list[1], 1);
  out += f(list[2], 2);
  out += f(list[3], 3);
  out += f(list[0], 4);
  out += f(list[1], 5);
  out += f(list[2], 6);
  out += f(list[3], 7);
  out += f(list[0], 8);
  out += f(list[1], 9);
  out += f(list[2], 10);
  out += f(list[3], 11);
  out += f(list[0], 12);
  out += f(list[1], 13);
  out += f(list[2], 14);
  out += f(list[3], 15);
  out += f(list[0], 16);
  out += f(list[1], 17);
  for (let i = 0; i < list.length; i++) out += f(list[i], i);
  return out;
}
const list = [1, 2, 3, 4];
console.log(
  each(list, function (x) {
    return arguments.length + x;
  }),
  each(list, (x, i) => x + i + 1),
  each(list, (x, i) => x + i + 2),
  each(list, function (x) {
    return arguments.length + x;
  }),
);
