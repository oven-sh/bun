// yield* calls `next` of what the library makes of a text, by the protocol.
const request = new Request("http://localhost/");
function* handedOn() {
  yield* JSON.parse('"p\\ud83d\\ude00q"');
}
let line = "";
for (const piece of handedOn()) line += piece.length;
console.log(line, request.method);
