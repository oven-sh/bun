// The same where the list is typed any and what is sought a number.
function find(list: any, wanted: number) {
  let i = list.length - 1;
  do {
    if (list[i] === wanted) break;
  } while (--i >= 0);
  console.log(i, Object.is(i, -1));
  return String(i);
}
console.log(find(JSON.parse("[28,56,25]"), 30));
