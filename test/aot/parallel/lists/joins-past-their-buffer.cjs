// The text of few primitives is collected in a buffer of the frame: integers, strings and fractions around its end, in every order.
const text = length => "abcdefghij".repeat(40).slice(0, length);
const numbers = [5, 12345678, -2147483648, 2147483647, 1.5, 123456.789, 1e21, 1e-7, NaN, -0, 1.7976931348623157e308, 5e-324, -1.7976931348623157e308];
let checked = 0;
function check(list, separator) {
  let expected = "";
  for (let i = 0; i < list.length; i++) expected += (i && separator !== undefined ? separator : i ? "," : "") + (list[i] === undefined || list[i] === null ? "" : String(list[i]));
  if (list.join(separator) !== expected || (separator === undefined && String(list) !== expected)) console.log("differs", list.length, list.join(separator).length, expected.length);
  checked++;
}
for (let length = 230; length <= 262; length++) {
  for (const number of numbers) {
    for (const separator of [undefined, "", " ", "é", ", "]) {
      check([text(length), number, text(200), text(200)], separator);
      check([number, text(length), number, true, text(3)], separator);
      check([text(length), number, number, number, number], separator);
      check([text(length), , number, undefined, text(1), null, number], separator);
      check([text(length - 10), number, text(5), number, "", false, text(250), number], separator);
    }
  }
}
console.log(checked, ["a".repeat(250), 12345678, "b".repeat(200), "c".repeat(200)].join(" ").length);
