const pattern = new URLPattern({ pathname: "/items/:id" });
console.log(pattern.exec("https://example.com/items/abc").pathname.groups.id.length, pattern.exec("https://example.com/other") === null, pattern.test("https://example.com/items/1"));
