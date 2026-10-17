// @ts-ignore
import { serialize } from "./untyped.js";

type Item = { id: number; title: string; priceCents: number; inStock: boolean };

const items: Item[] = [];
for (let id = 1; id <= 50; id++) items.push({ id, title: `Product ${id}`, priceCents: 199 + id * 350, inStock: id % 7 > 0 });

let length = 0;
for (let i = 0; i < 300; i++) length += serialize(items).length;
process.kill(process.pid, 0);
length += serialize(items).length;
process.kill(process.pid, 0);
console.log(length);
