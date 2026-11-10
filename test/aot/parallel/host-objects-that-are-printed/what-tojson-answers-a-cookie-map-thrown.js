// Exit code: 1
const cookies = new Bun.CookieMap("a=b"); cookies.toJSON = () => new URL("http://made.up/"); console.log("before"); throw cookies;
