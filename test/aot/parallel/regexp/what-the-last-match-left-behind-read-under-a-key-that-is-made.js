// The same, where no text of the program spells the name or says whose property it is.
function test(text) { return /(b)(c)/.test(text); }
function search(text) { return text.search(/(d)(e)/); }
const digits = [1, 2];
const holder = /x/.constructor;
test("abcde");
console.log(digits.map(digit => holder["$" + digit]).join());
search("abcde");
console.log(digits.map(digit => holder["$" + digit]).join(), holder["last" + "Match".slice(0)]);
