// STATISTIC: JoinedElementsSpeculatedCharacters >= 1
// result += s[i] + count beside s[i] === s[i + 1]: what is joined to a string is a character.
const parse = x => JSON.parse(JSON.stringify(x));
function compress(s) {
  let result = "",
    count = 1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === s[i + 1]) count++;
    else {
      result += s[i] + count;
      count = 1;
    }
  }
  return result;
}
const data = parse({ text: "aaabccddddde", none: "", one: "z", wide: "ééé☃☃😀😀", words: ["a", "a", "b", "", ""], numbers: [1, 1, 2.5, 2.5, 3], mixed: [null, null, "x", true, true, 1] });
for (let round = 0; round < 3; round++) {
  for (const name of Object.keys(data)) {
    try {
      console.log(name, compress(data[name]));
    } catch (e) {
      console.log(name, e.constructor.name);
    }
  }
}
