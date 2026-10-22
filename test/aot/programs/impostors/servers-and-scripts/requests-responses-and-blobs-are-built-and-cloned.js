const request = new Request("http://example.com/path?x=1", { method: "POST", headers: { "Content-Type": "application/json", "X-Id": "7" }, body: JSON.stringify({ a: 1 }) });
const twin = request.clone();
console.log(request.method, request.url, request.headers.get("content-type"), request.bodyUsed, await request.json(), request.bodyUsed, await twin.text(), request.redirect, request.mode, request.credentials, request.cache, request.signal.aborted);
const derived = new Request(new Request("http://h/", { headers: { a: "1" } }), { method: "PUT", body: "b", headers: { b: "2" } });
console.log(derived.method, [...derived.headers], await derived.text(), new Request("http://h/").body, new Request("http://h/a b").url);
for (const bad of [() => new Request("not a url"), () => new Request("http://h", { method: "GET", body: "x" }), () => new Request("http://h", { method: "TR ACE" }), () => new Response("x", { status: 99 }), () => new Response("x", { status: 204 }), () => new Headers({ "bad name": "x" })]) {
  try {
    bad();
    console.log("accepted");
  } catch (error) {
    console.log(error.name);
  }
}
const response = new Response("body", { status: 201, statusText: "Made", headers: [["a", "1"], ["a", "2"], ["B", "3"]] });
console.log(response.status, response.ok, response.statusText, response.headers.get("a"), [...response.headers.entries()], response.type, response.url, response.redirected, await response.clone().text(), (await response.bytes()).length);
console.log(Response.json({ a: [1] }).headers.get("content-type"), await Response.json({ a: [1] }, { status: 400 }).text(), Response.error().type, Response.error().status, Response.redirect("http://h/x", 301).headers.get("location"));
console.log(new Response(null).body, await new Response().text(), await new Response(new URLSearchParams({ a: "b c" })).text(), new Response(new URLSearchParams()).headers.get("content-type"), new Response(new Blob(["x"], { type: "text/x" })).headers.get("content-type"), new Response("x").headers.get("content-type"), new Response(new Uint8Array(2)).headers.get("content-type"));
const headers = new Headers();
headers.set("Zeta", "1");
headers.append("alpha", "2");
headers.append("Alpha", "3");
headers.append("Set-Cookie", "x=1");
headers.append("Set-Cookie", "y=2");
headers.delete("nothing");
console.log([...headers.keys()], headers.get("ALPHA"), headers.get("missing"), headers.getSetCookie(), headers.has("zeta"), headers.count ?? [...headers].length, JSON.stringify(headers), headers.toJSON?.());
const blob = new Blob(["héllo ", new Uint8Array([119, 111]), new Blob(["rld"])], { type: "Text/Plain" });
console.log(blob.size, blob.type, await blob.text(), await blob.slice(-3).text(), await blob.slice(1, 3, "a/b").arrayBuffer().then(buffer => buffer.byteLength), blob.slice(1, 3, "a/b").type, blob.slice(100).size);
const file = new File(["data"], "notes.txt", { type: "text/plain", lastModified: 5 });
console.log(file.name, file.size, file.type, file.lastModified, file instanceof Blob, await file.text());
const form = new FormData();
form.append("a", "1");
form.append("a", "2");
form.set("f", file, "renamed.txt");
console.log(form.get("a"), form.getAll("a"), form.get("f").name, form.has("z"), [...form.keys()], (await new Response(form).formData()).get("f").size, /^multipart\/form-data; boundary=/.test(new Response(form).headers.get("content-type")));
const [left, right] = new Response("tee me").body.tee();
console.log(await new Response(left).text(), await Bun.readableStreamToText(right), AbortSignal.abort("why").reason, AbortSignal.any([new AbortController().signal, AbortSignal.abort()]).aborted);
