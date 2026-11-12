function place(address: URL, host: string, port: string): void {
  address.hostname = host;
  address.port = port;
}
function sign(address: URL, name: string, word: string): void {
  address.username = name;
  address.password = word;
}
function ask(address: URL, path: string, query: string, mark: string): void {
  address.pathname = path;
  address.search = query;
  address.hash = mark;
}
(globalThis as any).placeByStrangers = place;
(globalThis as any).signByStrangers = sign;
(globalThis as any).askByStrangers = ask;

const address = new URL("https://example.com/a?b=1#c");
for (const [host, port] of [["shop.example", "8080"], ["EXAMPLE.org", ""], ["", "70000"], ["a b", "12x"], ["[::1]", "443"], ["xn--mller-kva.example", "0"]]) {
  place(address, host, port);
  console.log(address.href, address.host, address.origin);
}
for (const [name, word] of [["zoe", "s3cret"], ["a:b", "c@d"], ["", ""], ["ü", "%"]]) {
  sign(address, name, word);
  console.log(address.href, address.username, address.password);
}
for (const [path, query, mark] of [["/x/y", "?q=1", "#top"], ["no-slash", "q=2&r=3", "bottom"], ["", "", ""], ["/ä ö", "?ä=ö", "#ä"], ["/../..", "??", "##"]]) {
  ask(address, path, query, mark);
  console.log(address.href, address.searchParams.toString());
}
const file = new URL("file:///tmp/a.txt");
place(file, "host.example", "21");
sign(file, "me", "pw");
console.log(file.href);
const opaque = new URL("mailto:someone@example.com");
place(opaque, "other.example", "25");
ask(opaque, "else@example.com", "?subject=x", "#y");
console.log(opaque.href);
