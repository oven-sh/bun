const kEscape = "\x1b";

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

export default { CSI };
