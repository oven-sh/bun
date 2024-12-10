const { validateString } = require("internal/validators");

const StringPrototypeNormalize = String.prototype.normalize;
const RegExpPrototypeSymbolReplace = RegExp.prototype[Symbol.replace];

const internalGetStringWidth = $newZigFunction("string.zig", "String.jsGetStringWidth", 1);

const kEscape = "\x1b";

/**
 * Returns the number of columns required to display the given string.
 */
var getStringWidth = function getStringWidth(str, removeControlChars = true) {
  if (removeControlChars) str = stripVTControlCharacters(str);
  str = StringPrototypeNormalize.$call(str, "NFC");
  return internalGetStringWidth(str);
};

// Regex used for ansi escape code splitting
// Adopted from https://github.com/chalk/ansi-regex/blob/HEAD/index.js
// License: MIT, authors: @sindresorhus, Qix-, arjunmehta and LitoMore
// Matches all ansi escape code sequences in a string
var ansiPattern =
  "[\\u001B\\u009B][[\\]()#;?]*" +
  "(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*" +
  "|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)" +
  "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))";
var ansi = new RegExp(ansiPattern, "g");

/**
 * Remove all VT control characters. Use to estimate displayed string width.
 */
function stripVTControlCharacters(str) {
  validateString(str, "str");
  return RegExpPrototypeSymbolReplace.$call(ansi, str, "");
}

function CSI(strings, ...args) {
  var ret = `${kEscape}[`;
  for (var n = 0; n < strings.length; n++) {
    ret += strings[n];
    if (n < args.length) ret += args[n];
  }
  return ret;
}

CSI.kEscape = kEscape;
CSI.kClearLine = CSI`2K`;
CSI.kClearScreenDown = CSI`0J`;
CSI.kClearToLineBeginning = CSI`1K`;
CSI.kClearToLineEnd = CSI`0K`;

const utils = {
  getStringWidth,
  stripVTControlCharacters,
};

export default { CSI, utils };
