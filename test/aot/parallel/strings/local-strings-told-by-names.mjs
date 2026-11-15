// STATISTIC: StringsToldApartByNames >= 1
// A string in a local variable has a version where loops reach the function; elsewhere the loop is right without one.
const parse = value => JSON.parse(JSON.stringify(value));
const texts = parse(["the quick  brown 12 fox", "", " ", "a,b,,c", "x"]),
  lists = parse([[" ", "a", "b", " "], [], [" "]]);
function words(r) {
  const text = r % 8 < 5 ? texts[r % 8] : lists[(r % 8) - 5];
  let count = 0,
    from = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === " ") {
      if (i > from) count += text.slice(from, i).length;
      from = i + 1;
    }
  }
  return count + text.indexOf("b");
}
let total = 0;
for (let r = 0; r < 64; r++) total = total * 0.5 + words(r);
console.log(total, Array.from({ length: 8 }, (_, r) => words(r)).join());
