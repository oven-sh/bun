// The rows are fields' strings, lists or neither; each row is told apart in front of the inner loop.
// STATISTIC: ArrayOrStringLoopsVersioned >= 1
const text = process.argv.length > 9 ? "" : '{"words":["apple","banana","cat"],"count":1}';
const parse = () => JSON.parse(text);

function countLetters(holder) {
  let found = 0;
  for (let i = 0; i < holder.words.length; i++)
    for (let j = 0; j < holder.words[i].length; j++) if (holder.words[i][j] === "a") found++;
  return found;
}

function countBesideStores(holder, other) {
  let found = 0;
  for (let i = 0; i < holder.words.length; i++)
    for (let j = 0; j < holder.words[i].length; j++) {
      if (holder.words[i][j] === "a") found++;
      holder.count = found;
      if (found === 3) other.words = ["aaaa", "bab", "a"];
      if (found === 5) other.words[i] = "xaxa";
    }
  return found;
}

function countInBoth(holder, other) {
  let found = 0;
  for (let i = 0; i < holder.words.length; i++)
    for (let j = 0; j < holder.words[i].length; j++) {
      if (holder.words[i][j] === "a") found++;
      if (other.words[i][j] === "a") found += 100;
    }
  return found;
}

function countUnderKey(holder, key) {
  let found = 0;
  for (let i = 0; i < holder.words.length; i++)
    for (let j = 0; j < holder.words[i].length; j++) {
      if (holder.words[i][j] === "a") found++;
      holder[key] = key === "words" && found === 2 ? ["bab", "aab", "zz"] : holder[key];
    }
  return found;
}

function withWords(words) {
  const holder = parse();
  holder.words = words;
  return holder;
}

let heard = 0;
const kinds = [
  () => ["apple", "banana", "cat"],
  () => [["a", "b"], ["a"], []],
  () => ["apple", ["a", "b"], "cat"],
  () => ["apple", , "cat"],
  () => [],
  () => "abc",
  () => [1, "a"],
  () => ["a" + text.length, (text[0] + "a").repeat(4)],
  () => ["\u{1F600}a", "Āa"],
  () => [new Uint8Array([97, 98]), "a"],
  () => [new String("aab"), "a"],
  () => [{ length: 2, 0: "a", 1: "b" }, "ab"],
  () => Object.freeze(["ab", "aa"]),
  () => new Proxy(["ab", "aa"], { get: (target, key) => (heard++, target[key]) }),
  () => undefined,
  () => new (class extends Array {})("ab", "ba"),
];
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.name;
  }
};

for (let kind = 0; kind < kinds.length; kind++) {
  const holder = withWords(kinds[kind]());
  const other = withWords(kinds[0]());
  const read = Object.defineProperty(parse(), "words", { get: () => (heard++, kinds[kind]()), set: value => (heard += 10) });
  console.log(kind, attempt(() => countLetters(holder)), attempt(() => countLetters(read)), attempt(() => countBesideStores(holder, other)), attempt(() => countBesideStores(withWords(kinds[kind]()), holder)), attempt(() => countBesideStores(holder, holder)), attempt(() => countBesideStores(read, read)), attempt(() => countInBoth(withWords(kinds[kind]()), withWords(kinds[(kind + 1) % 3]()))), attempt(() => countUnderKey(withWords(kinds[kind]()), "words")), attempt(() => countUnderKey(withWords(kinds[kind]()), "count")), holder.count, heard);
}
