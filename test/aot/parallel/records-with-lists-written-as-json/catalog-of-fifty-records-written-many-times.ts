// a record with a list of fifty records, whose fields are proven, is written many times: the text is that of plain Bun
type Item = { id: number; title: string; priceCents: number; inStock: boolean };
type Catalog = { name: string; items: Item[] };
let sunk = 0;
let last = "";
function make(n: number): Catalog { const items: Item[] = []; for (let i = 0; i < 50; i++) items.push({ id: i, title: "product \"" + i + "\"", priceCents: 100 + i * 7.5, inStock: (i & 3) !== 0 }); return { name: "c" + n, items }; }
const fixed = make(1);
function send(status: number, value: Catalog): void { const body = JSON.stringify(value); sunk += status + body.length; last = body; }
function shape() { for (let i = 0; i < 300; i++) send(200, fixed); }
shape();
console.log(sunk, last);
