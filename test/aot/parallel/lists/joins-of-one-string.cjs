// A list of one string is that string. Strings of each length are copied into a join beside numbers.
const said = [];
function join(list, separator) {
  return separator === undefined ? list.join() : list.join(separator);
}
const long = "abcdefghijklmnopqrstuvwxyz".repeat(12);
for (const text of ["", "a", "rope" + said.length + "end", long, long.slice(2, 9), "中", "中" + long])
  for (const separator of [undefined, "", "-", "--", "中"]) {
    const joined = join([text], separator);
    said.push(joined === text, String([text]) === text, joined.length);
    const list = [text];
    list.push(1);
    list.length = 1;
    said.push(join(list, separator) === text);
  }
for (let length = 0; length < 40; length++) {
  const list = [long.slice(0, length), 1.5, null, long.slice(3, 3 + length), -7, true, undefined];
  said.push(join(list, "+"));
}
console.log(said.join(" "));
