// STATISTIC: CodeUnitsPassedToStringFromCharCode >= 1
// The call is in no loop. The loop is in the caller.
function tokenAt(source, position) {
  const code = source.codes[position];
  switch (code) {
    case 40:
    case 41:
      return ["bracket", String.fromCharCode(code), position];
    default:
      return String.fromCharCode(code);
  }
}
const sources = JSON.parse('[{ "codes": [40, 41, 65, 8364, 65536, 65601, -1, 1.5, "66", null, true, "x", 4294967361] }, { "codes": [40] }]');
let text = "";
for (let k = 0; k < 3; k++) {
  for (const source of sources) {
    for (let position = 0; position <= source.codes.length; position++) text += JSON.stringify(tokenAt(source, position)) + " ";
  }
  text += tokenAt({ codes: [{ valueOf() { text += "asked "; return 67; } }] }, 0) + "\n";
}
console.log(text);
try {
  tokenAt({ codes: [Symbol("s")] }, 0);
} catch (error) {
  console.log(error instanceof TypeError);
}
