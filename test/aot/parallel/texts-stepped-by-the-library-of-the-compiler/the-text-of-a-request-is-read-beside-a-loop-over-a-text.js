// The method that the loop no longer finds is called by its name, off the object and off a value that nobody knows.
const unseen = value => [value][JSON.parse("0")];
const made = () => new Request("http://localhost/", { method: "POST", body: "sent" });
for (const piece of unseen("ab")) console.log(piece);
console.log(await made().text());
const hidden = unseen(made());
console.log(typeof hidden.text, await hidden.text());
console.log(await unseen(new Blob(["kept"])).text(), await unseen(new Response("given")).text());
