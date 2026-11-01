// Flags: --aot-verify-each-pass
// Nothing but lengths of strings gives the pass that drops a repeated read any work here. A build that verifies each pass holds it to what it says about when it has work.
function replaceLoneSurrogates(input) {
  let result = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        result += input[i] + input[i + 1];
        i++;
        continue;
      }
    }
    result += code >= 0xd800 && code <= 0xdfff ? "�" : input[i];
  }
  return result;
}
console.log([...replaceLoneSurrogates("a😀b\ud83d")].map(c => c.codePointAt(0).toString(16)).join(" "));
