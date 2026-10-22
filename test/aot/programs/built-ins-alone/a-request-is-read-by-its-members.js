const request = new Request("https://example.com/a", { method: "POST", body: "[1.5]", headers: { first: "1" } });
console.log(request.method.length, request.url.length, request.headers.get("first").length, (await request.json())[0] + 1, request.bodyUsed);
