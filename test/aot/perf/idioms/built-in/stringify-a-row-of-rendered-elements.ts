import { nextTurns } from "../host.ts";
let kept: unknown;
type Props = Record<string, unknown>;
const element = (tag: string, key: string | null, props: Props): unknown[] => ["$", tag, key, props];
function rowOf(n: number): unknown[] {
  const id = "meadow-" + n;
  return element("tr", id, { className: n & 1 ? "odd" : "even", id, children: [
    element("td", null, { children: n }),
    element("td", null, { children: [element("a", null, { href: "/products/" + id, children: "Rustic Rug " + n }), element("ul", null, { className: "tags", children: ["new", "sale", "small"].map(tag => element("li", tag, { className: "tag tag-" + tag, children: tag })) })] }),
    element("td", null, { children: element("span", null, { className: "price", children: [element("span", null, { className: "currency", children: "EUR" }), " ", "146.19"] }) }),
    element("td", null, { children: element("span", null, { className: "rating", title: "2.5 of 5", children: ["***", "--", " ", element("small", null, { children: ["(", 188, ")"] })] }) }),
    element("td", null, { children: element("span", null, { className: "dimensions", children: [79, " x ", 32, " x ", 10, " cm"] }) }),
    element("td", null, { children: element("span", null, { className: "stock", children: "in stock" }) }),
    element("td", null, { children: element("$L15", null, { id, name: "Rustic Rug " + n, isAvailable: true }) }),
  ] });
}
const rows = [rowOf(30), rowOf(31)];
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const text = JSON.stringify(rows[i & 1]);
    kept = text;
    s = (s + text.length) | 0;
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check, typeof kept);
