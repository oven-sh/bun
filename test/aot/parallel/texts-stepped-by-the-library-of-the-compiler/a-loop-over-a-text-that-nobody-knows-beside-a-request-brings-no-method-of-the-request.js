// A loop over a value that nobody knows steps a text by what the compiler's own library makes of it. The fields of that lie under names that no object of the host has, so the loop finds no method of the Request, and nothing here makes a promise.
// STATISTIC: ImageFunctionsEmitted <= 30
const request = new Request("http://localhost/", { method: "POST" });
for (const piece of JSON.parse('"a\\ud83d\\ude00b"')) console.log(piece, piece.length);
console.log(request.method);
