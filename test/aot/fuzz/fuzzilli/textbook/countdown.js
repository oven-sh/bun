function countdown(from) {
  const said = [];
  let i = from;
  do {
    said.push(i);
    i--;
  } while (i >= 0);
  return said.join() + " then " + i;
}
console.log(countdown(Number("3")), countdown(Number("0")));
