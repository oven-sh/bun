const cookie = new Bun.Cookie("name", "value");
const cookies = new Bun.CookieMap("first=1; second=two");
console.log(cookie.name.length, cookie.value.length, cookies.get("second").length, cookies.get("missing") === null, cookies.size + 1);
