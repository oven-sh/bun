// A pattern that parses but is too large to build throws from new RegExp(), not from the first match.
function tryOut(text, flags) {
  let made;
  try {
    made = new RegExp(text, flags);
  } catch (error) {
    return "refused when made: " + error.name;
  }
  try {
    return "made; test answers " + made.test("aaa");
  } catch (error) {
    return "made; refused when used: " + error.name;
  }
}
const cases = JSON.parse(`[
  ["a{4294967295}", ""], ["a{4294967295}b", ""], ["a{4294967295}b", "u"], ["a{4294967295}b", "v"], ["a{4294967295}b", "i"], ["ba{4294967295}", ""],
  ["a{4294967294}b", ""], ["a{4294967296}b", ""], ["a{2147483648}b", ""], ["a{2147483647}b", ""], ["a{4294967295,}b", ""], ["a{0,4294967295}b", ""], ["a{1,4294967294}b", ""],
  ["(?:a{4294967295}){2}", ""], ["(?:a{4294967295}){2}b", ""], ["(a{65536}){65536}", ""], ["(a{65536}){65536}b", ""], ["(?:a{65536}b){65536}c", ""], ["(a{4294967295})b", ""],
  ["(?=a{4294967295})b", ""], ["(?<=a{4294967295})b", ""], ["(?<!a{4294967295}b)c", ""], ["[ab]{4294967295}c", ""], [".{4294967295}c", "s"], ["\\\\d{4294967295}c", ""],
  ["(?:ab){4294967295}c", ""], ["(?:ab){2147483648}c", ""], ["(a)\\\\1{4294967295}b", ""], ["a{3}{4294967295}", ""], ["a{2}b{3}c{4}", ""], ["a{1000000}b{1000000}", ""],
  ["[^\\\\q{ab}]", "v"], ["[^\\\\q{a}]", "v"], ["\\\\P{RGI_Emoji}", "v"], ["[^\\\\p{RGI_Emoji}]", "v"], ["[\\\\p{RGI_Emoji}]", "v"], ["[^[\\\\q{ab}]]", "v"], ["[[a-z]--[aeiou]]", "v"],
  ["(", ""], ["a{2,1}", ""], ["\\\\k<x>", "u"], ["(?<x>a)(?<x>b)", ""], ["[b-a]", ""], ["\\\\p{Nope}", "u"], ["a**", ""], ["(?<=a)+", "u"]
]`);
for (const [text, flags] of cases) console.log(JSON.stringify(text), flags, tryOut(text, flags));
