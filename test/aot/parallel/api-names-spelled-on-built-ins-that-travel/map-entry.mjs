const map = new Map([["api", Bun]]);
console.log(map.get("api").escapeHTML("<a>"));
