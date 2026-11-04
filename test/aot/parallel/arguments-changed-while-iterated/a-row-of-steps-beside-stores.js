function rowThenStore() {
  const [first, second] = arguments;
  arguments[0] = "Z";
  const [third, fourth] = arguments;
  arguments.length = 1;
  const [fifth, sixth] = arguments;
  return [first, second, third, fourth, fifth, String(sixth)].join();
}
let text = "";
for (let turn = 0; turn < 300; turn++) text = rowThenStore("a", "b" + turn);
console.log(text);
