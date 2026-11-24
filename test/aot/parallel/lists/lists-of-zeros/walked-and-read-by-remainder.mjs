const zeros = [0, 0];
function last(limit) {
  let found = 0;
  for (const each of zeros) found = zeros[limit % 3];
  return found;
}
console.log(last(33));
