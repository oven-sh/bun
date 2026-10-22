const request = new Request("https://example.com/", { method: "POST", body: "abc" });
const copy = request.clone();
console.log(copy !== request, (await copy.text()).length, (await request.text()).length, request.signal instanceof AbortSignal, request.signal.aborted);
