// The programs of untyped-loops that are one text but for a few places.
import { family, programsOf } from "../generate";

export const programs = () =>
  programsOf({
    ...family(
      `number-becomes-string.js			ypeof total === "string" ? total.length : t	mixed	6
one-string-in-a-thousand.js		 * 1		rarelyText	30
overflowing-integers.js	214748300			integers	30
sum-of-doubles.js		 / 3.7		integers	30
sum-of-fractions.js				fractions	30
sum-of-integers.js				integers	30`,
      (
        a,
        b,
        c,
        d,
        e,
      ) => `// The elements come out of JSON.parse, so that nothing about them is known before the program runs. The list itself is an array of the program.
function make(kind, length) {
  var items = [];
  for (var i = 0; i < length; i++) {
    var n = (i * 7919 + 13) % 1000;
    if (kind === "integers") items.push(n);
    else if (kind === "fractions") items.push(n + 0.25);
    else if (kind === "words") items.push("w" + (n % 10));
    else if (kind === "mixed") items.push(i === length >> 1 ? "x" : n);
    else if (kind === "rarelyText") items.push(i % 1000 === 999 ? String(n) : n);
    else if (kind === "permutation") items.push((i * 7 + 3) % length);
  }
  var parsed = JSON.parse(JSON.stringify({ items: items }));
  var copy = [];
  for (var j = 0; j < length; j++) copy.push(parsed.items[j]);
  return copy;
}

function kernel(values) {
  var total = ${a}0;
  for (var i = 0; i < values.length; i++) total += values[i]${b};
  return t${c}otal;
}

var input = make("${d}", 1000);
var checksum = 0;
for (var round = 0; round < ${e}000; round++) checksum = (checksum + kernel(input)) % 1000000007;
console.log(checksum);
`,
    ),
  });
