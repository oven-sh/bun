const list = Array(2 ** 32 - 1);
let caught = "nothing";
try {
  list.push(0, 0);
} catch (error) {
  caught = error.constructor.name;
}
console.log(caught, list.length, list[2 ** 32], list[2 ** 32 - 1], list[2 ** 32 - 2]);
