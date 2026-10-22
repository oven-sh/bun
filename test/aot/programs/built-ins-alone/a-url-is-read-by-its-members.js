const url = new URL("https://example.com:8080/a?first=1&second=two#part");
console.log(url.port.length, url.searchParams.get("second").length, url.searchParams.get("missing") === null, url.hash, url.searchParams === url.searchParams);
