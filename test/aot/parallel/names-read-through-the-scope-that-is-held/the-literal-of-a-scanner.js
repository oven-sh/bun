function createScanner(version, skipTrivia, variant = 0, textInitial, onError) {
  var text = textInitial, pos = 0, end = text.length, token = 0;
  var scanner = {
    getPos: () => pos, getToken: () => token, getText: () => text, isSkipping: () => skipTrivia,
    scan, rescan, reset, setPos: reset, setOnError,
  };
  return scanner;
  function error(message) { if (onError) onError(message, pos); }
  function scan() {
    while (pos < end) {
      const ch = text.charCodeAt(pos++);
      if (ch === 32) { if (skipTrivia) continue; return (token = 1); }
      if (ch === 33) { error("bang" + version + variant); continue; }
      return (token = ch);
    }
    return (token = -1);
  }
  function rescan() { pos = 0; return skipTrivia ? scan() : token; }
  function reset(to) { pos = to; token = 0; }
  function setOnError(handler) { onError = handler; }
}
for (const skip of [true, false]) {
  const said = [], s = createScanner(9, skip, undefined, "a !b", (m, at) => said.push(m + at));
  const tokens = []; for (let t = s.scan(); t !== -1; t = s.scan()) tokens.push(t);
  console.log(tokens.join(), said.join(), s.rescan(), s.getPos(), s.isSkipping(), s.reset === s.setPos, s.scan === s.scan);
  s.setOnError(undefined); s.setPos(2); console.log(s.scan(), said.length);
}
