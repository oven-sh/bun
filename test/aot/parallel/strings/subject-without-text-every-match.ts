// Every match of these patterns holds a character or a text that stands behind a run of many characters. In a subject without it no place is tried: there is a search for that text in front of the search
// for a match. Beside each stands the same pattern with one more alternative, a run longer than any in the subject, which holds nothing in particular: that one has to be tried place by place.
// Env of the build: BUN_JSC_verboseRegExpCompilation=1
// Env of the executable: BUN_JSC_verboseRegExpCompilation=1
// Build prints: 12 x Searches for 1 texts that every match holds
const nothing = String(Date.now()).slice(99);
const words = "the worker-7 finished job 8123 in 41 ms with status ok and no retries left ".repeat(1500) + "end";
const searches: [string, RegExp, RegExp][] = [
  ["a literal, a character behind a bounded run:", /\b([a-z0-9-]{1,64}@[a-z0-9-]+)\b/i, /\b([a-z0-9-]{1,64}@[a-z0-9-]+)\b|[a-z0-9-]{70}/i],
  ["a literal, a text behind two runs:", /\b([a-z0-9-]+\.[a-z0-9-]+\.example\.invalid)\b/i, /\b([a-z0-9-]+\.[a-z0-9-]+\.example\.invalid)\b|[a-z0-9-]{70}/i],
  ["a literal, one of two signs behind a word:", /\b[a-z]+\s*[=#]\s*(\S+)/i, /\b[a-z]+\s*[=#]\s*(\S+)|[a-z]{70}/i],
  ["a literal in unicode mode, a character behind a bounded run:", /\b([\p{L}\p{N}-]{1,64}@[a-z0-9-]+)\b/u, /\b([\p{L}\p{N}-]{1,64}@[a-z0-9-]+)\b|[\p{L}\p{N}-]{70}/u],
  ["a literal, a run that has to reach the end:", /[ \t\r\n\xa0\u2003\ufeff]+$/, /[ \t\r\n\xa0\u2003\ufeff]+$|[a-z0-9-]{70}/],
  ["a literal, a run at the start or one that has to reach the end:", /^[ \t\r\n\xa0\u2003\ufeff]+|[ \t\r\n\xa0\u2003\ufeff]+$/, /^[ \t\r\n\xa0\u2003\ufeff]+|[ \t\r\n\xa0\u2003\ufeff]+$|[a-z0-9-]{70}/],
  ["run-time text, a run that has to reach the end:", new RegExp("[ \\t\\xa0]+$" + nothing), new RegExp("[ \\t\\xa0]+$|[a-z0-9-]{70}" + nothing)],
  ["run-time text, a character behind a bounded run:", new RegExp("\\b([a-z0-9-]{1,63}@[a-z0-9-]+)\\b" + nothing, "i"), new RegExp("\\b([a-z0-9-]{1,63}@[a-z0-9-]+)\\b|[a-z0-9-]{70}" + nothing, "i")],
  ["run-time text, a text behind two runs:", new RegExp("\\b([a-z0-9-]+\\.[a-z0-9-]+\\.example\\.test)\\b" + nothing, "i"), new RegExp("\\b([a-z0-9-]+\\.[a-z0-9-]+\\.example\\.test)\\b|[a-z0-9-]{70}" + nothing, "i")],
  ["run-time text that looks back over a group, a character behind a run:", new RegExp("(?<!(?:x|y)+z)\\b([a-z0-9-]{1,64}@[a-z0-9-]+)\\b" + nothing, "i"), new RegExp("(?<!(?:x|y)+z)\\b([a-z0-9-]{1,64}@[a-z0-9-]+)\\b|[a-z0-9-]{70}" + nothing, "i")],
];
for (const subject of [words, "\u4e00 " + words]) {
  for (const [name, pattern, triedEverywhere] of searches) console.log(name, pattern.test(subject), triedEverywhere.test(subject));
}
/* Output:
a literal, a character behind a bounded run: false false
a literal, a text behind two runs: false false
a literal, one of two signs behind a word: false false
a literal in unicode mode, a character behind a bounded run: false false
a literal, a run that has to reach the end: false false
a literal, a run at the start or one that has to reach the end: false false
run-time text, a run that has to reach the end: false false
run-time text, a character behind a bounded run: false false
run-time text, a text behind two runs: false false
run-time text that looks back over a group, a character behind a run: false false
a literal, a character behind a bounded run: false false
a literal, a text behind two runs: false false
a literal, one of two signs behind a word: false false
a literal in unicode mode, a character behind a bounded run: false false
a literal, a run that has to reach the end: false false
a literal, a run at the start or one that has to reach the end: false false
run-time text, a run that has to reach the end: false false
run-time text, a character behind a bounded run: false false
run-time text, a text behind two runs: false false
run-time text that looks back over a group, a character behind a run: false false
Searches for 1 texts that every match holds
Runs on a flat program
Runs on a flat program
Searches for 1 texts that every match holds
Runs on a flat program
Runs on a flat program
Searches for 1 texts that every match holds
Runs on a flat program
Runs on a flat program
Searches for 1 texts that every match holds
Runs on a flat program
Runs on a flat program
*/
