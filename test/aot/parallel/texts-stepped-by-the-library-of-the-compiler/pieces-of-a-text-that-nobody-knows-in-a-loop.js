// Pairs of surrogates stay together, lone ones stand alone, and an empty text gives nothing.
const request = new Request("http://localhost/");
for (const text of JSON.parse('["a\\u00f1\\ud83d\\ude00b\\ud83d\\ude00", "\\ud83dx\\ude00\\ud83d", ""]')) {
  let line = "";
  for (const piece of text) line += piece.length + ":" + piece.codePointAt(0).toString(16) + " ";
  console.log(line + ".");
}
console.log(request.method);
