// Whoever prints one of these prints what its toJSON() answers and calls that answer's own method, the printer of errors too.
// Exit code: 1
const cookie = new Bun.Cookie("made", "up");
cookie.toJSON = () => new URL("http://made.up/");
const cookies = new Bun.CookieMap("made=up");
cookies.toJSON = () => [new URL("http://made.up/")];
console.log("before");
reportError(cookie);
throw cookies;
