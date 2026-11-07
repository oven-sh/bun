// The name and the length of constructors of the host are kept in the fields of literals, also of the two that have Object.prototype above them.
function ofCookieMap() {
  return { name: Bun.CookieMap.name, length: Bun.CookieMap.length };
}
function ofCookie() {
  return { name: Bun.Cookie.name, length: Bun.Cookie.length };
}
function ofWorker() {
  return { name: Worker.name, length: Worker.length };
}
function describedOnCookieMap(key) {
  const description = Object.getOwnPropertyDescriptor(Bun.CookieMap, "name");
  return { value: description.value, writable: description.writable };
}
console.log(JSON.stringify([ofCookieMap(), ofCookie(), ofWorker(), describedOnCookieMap()]));
console.log(Reflect.ownKeys(Bun.CookieMap).join(), Object.getPrototypeOf(Bun.CookieMap) === Object.prototype, Object.getPrototypeOf(Bun.Cookie) === Object.prototype);
