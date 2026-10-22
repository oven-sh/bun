// One loop is entered with each kind of value that JSON.parse can give, so the copy of the loop for arrays, the copy for what is left and the way from one test to the tests behind it all run.
var text = JSON.stringify({
  numbers: [3, 1, 4, 1, 5, 9, 2, 6],
  words: ["a", "bc", "def"],
  mixed: [1, "two", null, true, [3], { four: 4 }],
  empty: [],
  string: "a text",
  emptyString: "",
  arrayLike: { length: 3, 0: 10, 1: 20, 2: 30 },
  noLength: { other: 1 },
  number: 12,
  boolean: true,
  nothing: null,
});

function sum(values) {
  var total = 0;
  for (var i = 0; i < values.length; i++) total += values[i];
  return total;
}

function lengths(values) {
  var total = 0;
  for (var i = 0; i < values.length; i++) {
    var item = values[i];
    if (item != null && item.length !== undefined) total += item.length;
    total += values.length;
  }
  return total;
}

function describe(run, value) {
  try {
    return String(run(value));
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

var data = JSON.parse(text);
var names = Object.keys(data);
var lines = [];
for (var round = 0; round < 300; round++) {
  if (round % 100 === 0) data = JSON.parse(text);
  for (var n = 0; n < names.length; n++) {
    var line = names[n] + ": " + describe(sum, data[names[n]]) + " | " + describe(lengths, data[names[n]]);
    if (round === 0) lines.push(line);
    else if (lines[n] !== line) lines[n] = "CHANGED in round " + round + ": " + line;
  }
}
console.log(lines.join("\n"));
console.log(describe(sum, undefined), describe(lengths, undefined));
