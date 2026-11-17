// Sets and Maps made of Maps, Sets, texts and generators
function* letters(text) {
  for (const letter of text) yield letter;
}
function make(text) {
  const set = new Set(text);
  const map = new Map([...set].map((letter, i) => [letter, i]));
  const again = new Set(map);
  const turned = new Map([...map].map(([letter, i]) => [i, letter]));
  const copy = new Map(map);
  copy.delete(text[0]);
  return [set.size, again.size, [...again][0]?.length, turned.get(0), copy.size, map.size, new Set(letters(text)).size, Array.from(map.keys()).join(""), new Set(new Set(set).keys()).size].map(String).join();
}
console.log(make("hello"));
console.log(make("aaaa"));
console.log(make("xyz"));
