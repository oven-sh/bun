const url = new URL("https://example.com/a?b=1");
console.log(url.href, url.pathname, url.search);
url.pathname = "/c";
console.log(url.href, url.pathname);
url.search = "";
console.log(url.href, url.search.length, [...url.searchParams].length);
