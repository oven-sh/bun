// A pattern made at run time whose search goes back over the same places again and again answers what plain Bun answers: the same match, the same groups, and no match where plain Bun gives the match up.
const nothing = String(Date.now()).slice(99);
function show(name, source, flags, subject) {
  const match = new RegExp(source + nothing, flags).exec(subject + nothing);
  console.log(name, match === null ? "no match" : [match.index, match[0].length, ...match.slice(1).map(group => (group === undefined ? "-" : group.length))].join(" "));
}
const command = "echo foo | grep bar > baz.txt; cat qux.log; ".repeat(28);
show("five stars, none", "^.*foo.*bar.*baz.*qux.*quux.*$", "", command);
show("five stars", "^.*foo.*bar.*baz.*qux.*log.*$", "", command);
show("five stars, not anchored", ".*foo.*bar.*baz.*qux.*quux.*", "", command);
show("five stars on the second line", "^.*foo.*bar.*baz.*qux.*quux.*$", "m", command + "\n" + command + "quux\n" + command);
show("five stars from the middle of a line", ".*bar.*baz.*qux.*foo.*quux.*", "s", command + "\n" + command);
show("lazy stars", "(.*?),(.*?),(.*?),(.*?);", "", "ab,".repeat(150));
show("lazy stars that match", "(.*?),(.*?),(.*?),(.*?);", "", "ab,".repeat(150) + ";");
show("stars in optional groups", "^(?:.*/)?(?:.*/)?(?:.*/)?(?:.*/)?end$", "", "a/".repeat(120) + "x");
show("stars in optional groups that match", "^(.*/)?(.*/)?(.*/)?(.*/)?end$", "", "a/".repeat(120) + "end");
show("words", "^(?:\\w+\\s*)+;$", "", "alpha beta gamma delta eps");
show("words that match", "^(\\w+\\s*)+;$", "", "alpha beta gamma delta eps;");
show("assignments", "(?:\\w+=\\S*\\s+)*end$", "", "A=k ".repeat(600) + "no");
show("turns that may take nothing", "^(a*)*b$", "", "a".repeat(22) + "c");
show("turns that may take nothing, lazy", "^(?:a*?|b)*?c$", "", "a".repeat(20) + "d");
show("turns that may take nothing in turns that may take nothing", "^(?:(?:a*)*b?)*c$", "", "a".repeat(14) + "d");
show("counted turns", "^(?:a+){2,}b$", "", "a".repeat(22) + "c");
show("a group that is referred to", "^(a+)+\\1b$", "", "a".repeat(20) + "c");
show("a lookahead", "^(?=(a+)+b)a*", "", "a".repeat(22) + "c");
show("alternatives", "^(?:a|aa|aaa)+b$", "", "a".repeat(26) + "c");
// Plain Bun gives a match up at the hundred millionth turn that the groups of a pattern begin.
for (let count = 20; count <= 28; count++) show("a match behind " + count, "^(?:(a+)+b|a+c)$", "", "a".repeat(count) + "c");
for (let count = 30; count <= 37; count++) show("another behind " + count, "(?:a|aa)+b|c", "", "a".repeat(count) + "c");
for (let count = 24; count <= 28; count++) show("behind turns that are counted, " + count, "^(?:(?:a+){2,}b|a+c)$", "", "a".repeat(count) + "c");
for (let count = 24; count <= 28; count++) show("behind a lookahead, " + count, "^(?:(?=(a+)+b)a|a+c)$", "", "a".repeat(count) + "c");
show("two to five turns", "^(?:a+){2,5}b$", "", "a".repeat(60) + "c");
show("a lookahead that must fail", "^(?!(a+)+b)a+c$", "", "a".repeat(22) + "c");
show("behind a lookbehind", "(?<=x)(a+)+b", "", "x" + "a".repeat(22) + "c");
show("behind a lookbehind that must fail", "(?<!y|zz)(a+)+b", "", "x" + "a".repeat(22) + "c");
for (let count = 25; count <= 28; count++) show("a match behind a lookbehind, " + count, "^x(?:(?<=^x)(a+)+b|a+c)$", "", "x" + "a".repeat(count) + "c");
// These can match at the end of the subject alone, and the search begins there: no turn is taken at an earlier place.
show("only at the end, after a lookahead that must fail", "(?!(?:.|a)*c)$", "u", "α" + "a".repeat(30));
show("only at the end, behind a lookbehind", "(?<=.)(?!(?:a|a)*c)$", "u", "α" + "a".repeat(30));
show("only at the end, a class that takes pairs", "(?!(?:[^x]|a)+c)$", "u", "α" + "a".repeat(34));
show("only at the end, behind a pair", "(?<=.)(?!(?:a|a)*c)$", "u", "a".repeat(30) + "😀");
for (let count = 25; count <= 28; count++) show("up to ninety-nine turns, " + count, "(?:a|a){0,99}c|a+", "", "a".repeat(count));
for (let count = 25; count <= 28; count++) show("three to two hundred turns, as few as may be, " + count, "(?:a|a){3,200}?c|a+", "", "a".repeat(count));
for (let count = 25; count <= 28; count++) show("a group that ignores case, " + count, "(?i:a|A)*c|a+", "", "a".repeat(count));
for (let count = 25; count <= 28; count++) show("an alternative that ignores case, " + count, "(?:a|(?i:A))*(?-i:c)|a+", "i", "a".repeat(count));
show("a group where the dot takes line ends", "^(?s:.+)+(?-s:.)x$", "", "ab\n".repeat(9) + "y");
// As plain Bun prints it: the run that shows so takes up to half a minute.
/* Output:
five stars, none no match
five stars 0 1232
five stars, not anchored no match
five stars on the second line 1233 1236
five stars from the middle of a line no match
lazy stars no match
lazy stars that match 0 451 2 2 2 441
stars in optional groups no match
stars in optional groups that match 0 243 240 - - -
words no match
words that match 0 27 3
assignments no match
turns that may take nothing no match
turns that may take nothing, lazy no match
turns that may take nothing in turns that may take nothing no match
counted turns no match
a group that is referred to no match
a lookahead no match
alternatives no match
a match behind 20 0 21 -
a match behind 21 0 22 -
a match behind 22 0 23 -
a match behind 23 0 24 -
a match behind 24 0 25 -
a match behind 25 0 26 -
a match behind 26 0 27 -
a match behind 27 no match
a match behind 28 no match
another behind 30 30 1
another behind 31 31 1
another behind 32 32 1
another behind 33 33 1
another behind 34 34 1
another behind 35 no match
another behind 36 no match
another behind 37 no match
behind turns that are counted, 24 0 25
behind turns that are counted, 25 0 26
behind turns that are counted, 26 0 27
behind turns that are counted, 27 no match
behind turns that are counted, 28 no match
behind a lookahead, 24 0 25 -
behind a lookahead, 25 0 26 -
behind a lookahead, 26 0 27 -
behind a lookahead, 27 no match
behind a lookahead, 28 no match
two to five turns no match
a lookahead that must fail 0 23 -
behind a lookbehind no match
behind a lookbehind that must fail no match
a match behind a lookbehind, 25 0 27 -
a match behind a lookbehind, 26 0 28 -
a match behind a lookbehind, 27 no match
a match behind a lookbehind, 28 no match
only at the end, after a lookahead that must fail 31 0
only at the end, behind a lookbehind 31 0
only at the end, a class that takes pairs 35 0
only at the end, behind a pair 32 0
up to ninety-nine turns, 25 0 25
up to ninety-nine turns, 26 0 26
up to ninety-nine turns, 27 no match
up to ninety-nine turns, 28 no match
three to two hundred turns, as few as may be, 25 0 25
three to two hundred turns, as few as may be, 26 0 26
three to two hundred turns, as few as may be, 27 no match
three to two hundred turns, as few as may be, 28 no match
a group that ignores case, 25 0 25
a group that ignores case, 26 0 26
a group that ignores case, 27 no match
a group that ignores case, 28 no match
an alternative that ignores case, 25 0 25
an alternative that ignores case, 26 0 26
an alternative that ignores case, 27 no match
an alternative that ignores case, 28 no match
a group where the dot takes line ends no match
*/
