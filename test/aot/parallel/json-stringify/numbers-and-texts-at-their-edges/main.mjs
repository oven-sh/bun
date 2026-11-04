// -0 is 0, what is no finite number is null, an integer past 2 ** 53 and a number past 1e21 are printed as the language prints them, and a text is escaped character by character.
function pair(n, t) { return { n, t }; }
const numbers = [0, -0, 1, -1, 2147483647, -2147483648, 2147483648, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), 1e21, 1e-7, 0.1 + 0.2, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308];
const texts = ["", "\"", "\\", "\n\r\t\b\f", "\u0000\u001f", "\u007f", "  ", "\ud800", "\udc00", "😀", "\ud83d", "é", "日本", "a".repeat(40)];
for (const n of numbers) console.log(JSON.stringify(pair(n, "t")));
for (const t of texts) console.log(JSON.stringify(pair(1, t)));
console.log(JSON.stringify({ "k\"e\ny": 1, " ": 2, "": 3 }));
