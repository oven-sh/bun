console.log(URL.parse("not a url") === null, URL.canParse("not a url"), URL.parse("https://example.com/a").pathname.length);
