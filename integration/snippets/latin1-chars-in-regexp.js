// original code:
// var re_btou = new RegExp(
//   [
//     "[\xC0-\xDF][\x80-\xBF]",
//     "[\xE0-\xEF][\x80-\xBF]{2}",
//     "[\xF0-\xF7][\x80-\xBF]{3}",
//   ].join("|"),
//   "g"
// );

var re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFFF]|[^\x00-\x7F]/g;
var re_utob = /[\uD800-\uDBFF][\uDC00-\uDFFFF]|[^\x00-\x7F]/g;
var re_btou = new RegExp(
  [
    "[\xC0-\xDF][\x80-\xBF]",
    "[\xE0-\xEF][\x80-\xBF]{2}",
    "[\xF0-\xF7][\x80-\xBF]{3}",
  ].join("|"),
  "g"
);

const real = [
  "[\xC0-\xDF][\x80-\xBF]",
  "[\xE0-\xEF][\x80-\xBF]{2}",
  "[\xF0-\xF7][\x80-\xBF]{3}",
]
  .flatMap((a) => a.split(""))
  .map((a) => a.codePointAt(0));

const expected = [
  91, 192, 45, 223, 93, 91, 128, 45, 191, 93, 91, 224, 45, 239, 93, 91, 128, 45,
  191, 93, 123, 50, 125, 91, 240, 45, 247, 93, 91, 128, 45, 191, 93, 123, 51,
  125,
];

export function test() {
  if (!real.every((point, i) => point === expected[i])) {
    throw new Error(
      `test failed.\n\nExpected:\n ${expected.join(
        " "
      )}\Received:\n ${real.join(" ")}`
    );
  }

  testDone(import.meta.url);
}
