// The first store to a list that was written in the text gives the list other storage. The loop asks for the length of the list on every turn.
// Flags: --aot-check=MovedLoads
function total(list) {
  let sum = 0;
  for (let index = 0; index < list.length; index++) {
    if (index + 1 < list.length) {
      if (list[index] === 100) list[index + 1] = 3;
      sum += list[index + 1];
    }
  }
  return sum;
}

const list = [1, 100, 3, 4, 100, 6, 7, 100, 9, 10, 100, 100, 13, 100, 15, 16, 100, 18, 100, 100, 21];
console.log(total(list), JSON.stringify(list));
