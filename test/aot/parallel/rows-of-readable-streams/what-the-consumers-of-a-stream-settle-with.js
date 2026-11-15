// text(), json(), bytes() and blob() of a stream.
// What `body` of a Response answers is known to be a stream: it is the very stream that the Response was made of.
const known = (...operands) => new Response(new ReadableStream(...operands)).body;
const made = text =>
  known({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
const text = await made("made up").text();
const json = await made('{"list":[1,{"deep":true}],"none":null}').json();
const bytes = await made("abc").bytes();
const blob = await made("abcd").blob();
json.list[1].deep = "stored";
console.log(text, JSON.stringify(json), Object.getPrototypeOf(bytes) === Uint8Array.prototype, bytes.join(), blob instanceof Blob, blob.size, await blob.text());
console.log(await made("7").json(), await made('"text"').json(), await made("null").json(), await made("true").json());
const failed = await made("{").json().then(
  () => "settled",
  error => error.name,
);
const locked = made("x");
locked.getReader();
const refused = await Promise.resolve()
  .then(() => locked.text())
  .then(
    () => "settled",
    error => `${error.name}: ${error.message}`,
  );
console.log(failed, refused);
