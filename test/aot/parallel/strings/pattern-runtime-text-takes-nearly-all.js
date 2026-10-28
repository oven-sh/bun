// Plain Bun gives a match up at the hundred millionth turn that the groups of a pattern begin. A pattern made at run time goes that far too. Its matcher stops long before that, and the match is then
// made again by a second matcher of the same kind, which counts the turns as plain Bun does. The interpreter of bytecode, which takes several times as long a turn, is not asked.
// Env of the executable: BUN_JSC_verboseRegExpCompilation=1
const nothing = String(Date.now()).slice(99);
// The turns grow with the square of the number of words: every `k` is a place to start at, and from each the inner group takes a turn for every word behind it.
const words = new RegExp("(?:\\n|\\bk\\s+(?:\\w+=\\S*\\s+)*)end" + nothing);
const subject = count => "k" + " A=k".repeat(count) + "\nno\nend";
// 9,900 words: 49 million turns. 14,140 words: 99.98 million. 14,150 words: over a hundred million.
console.log(words.test(subject(9900)), words.test(subject(14140)), words.test(subject(14150)));
// The answers are plain Bun's: the run that shows so takes up to half a minute.
/* Output:
true true false
Searches for 1 texts that every match holds
Runs on a flat program
Counts turns on a second flat program
*/
