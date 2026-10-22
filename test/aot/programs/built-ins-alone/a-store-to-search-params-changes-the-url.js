const url = new URL("https://example.com/");
url.searchParams.set("first", 1.5);
console.log(url.href, typeof url.searchParams.get("first"));
