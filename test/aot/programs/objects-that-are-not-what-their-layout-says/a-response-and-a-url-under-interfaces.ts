// Interfaces that a Response and a URL satisfy
interface HasStatus {
  status: number;
}
interface HasHref {
  href: string;
}
function status(v: HasStatus): string {
  return (
    v.status + "|" + (v instanceof Response) + "|" + Object.keys(v).join() + "|" + Object.prototype.toString.call(v)
  );
}
function href(v: HasHref): string {
  return v.href + "|" + (v instanceof URL) + "|" + Object.keys(v).join();
}
const a: HasStatus[] = [{ status: 1 }, new Response("x", { status: 201 })];
const b: HasHref[] = [{ href: "plain" }, new URL("http://a.test/b")];
for (let round = 0; round < 3; round++) {
  for (const v of a) console.log(status(v));
  for (const v of b) console.log(href(v));
}
