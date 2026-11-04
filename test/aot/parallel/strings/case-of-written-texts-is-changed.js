// written texts whose case does not change one character for one
function upper() { return ["ß".toUpperCase(), "ǆ".toUpperCase(), "ŉ".toUpperCase(), "abc".toUpperCase(), "ABC".toUpperCase(), "é".toUpperCase(), "".toUpperCase()]; }
function lower() { return ["İ".toLowerCase(), "Σ".toLowerCase(), "ΑΣ".toLowerCase(), "ABC".toLowerCase(), "abc".toLowerCase(), "Ǆ".toLowerCase()]; }
function deed(make) {
  return make().map(text => text + ":" + text.length + ":" + Array.from(text, c => c.codePointAt(0).toString(16)).join("-")).join(" ");
}
for (let turn = 0; turn < 3; turn++)
  console.log(deed(upper), deed(lower));
