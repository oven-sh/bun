// Counters that are fields of one object, raised in two loops
function count(text) {
  const counts = { words: 0, letters: 0, vowels: 0, longest: 0, last: null };
  for (const word of text.split(" ")) {
    if (word === "") continue;
    counts.words++;
    for (let i = 0; i < word.length; i++) {
      counts.letters += 1;
      if ("aeiou".includes(word[i])) ++counts.vowels;
    }
    if (word.length > counts.longest) counts.longest = word.length;
    counts.last = word;
  }
  return counts;
}
console.log(JSON.stringify(count("a small set of words")));
console.log(JSON.stringify(count("  x  yz ")));
console.log(JSON.stringify(count("")));
