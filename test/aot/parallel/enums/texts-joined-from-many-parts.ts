// A member whose text is joined from texts, numbers and other members, by `+` and in templates.
enum E {
  first = "x",
  twice = `${first}${first}`,
  joined = twice + twice + "-" + 1 + first,
  number = 1,
  sum = 1 + 2 + first,
  nested = `${number}${joined}` + number,
  inverted = "a" + ("b" + first) + `${"c" + first}d`,
  unpaired = "\ud83d" + "\ude00",
}
const enum C {
  first = "p",
  joined = first + first + `q${first}` + 1,
}
console.log(E.twice, E.joined, E.sum, E.nested, E.inverted, E.unpaired, C.joined, Object.keys(E).length);
