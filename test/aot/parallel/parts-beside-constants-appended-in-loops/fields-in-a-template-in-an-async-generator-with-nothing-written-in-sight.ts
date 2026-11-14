// the text grows in an async generator, out of fields of which the walk sees nothing written: what the pages hold comes through a for await
type ProductRow = { id: number; title: string; priceCents: number };
const products: ProductRow[] = JSON.parse(JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: "product " + i, priceCents: i % 3 ? 100 + i * 7 : 0.5 + i }))));
(products as any[]).push({ id: null, title: undefined, priceCents: true }, { id: "seven", title: 7, priceCents: -0 }, { id: 2 ** 31, title: "", priceCents: { toString() { return "an object"; } } });
async function findProducts(offset: number, limit: number): Promise<ProductRow[]> { return products.slice(offset, offset + limit); }
async function* productPages(size: number): AsyncGenerator<ProductRow[]> { for (let offset = 0; offset < products.length; offset += size) yield await findProducts(offset, size); }
async function* shape(): AsyncGenerator<string> { for await (const page of productPages(5)) { let text = ""; for (const product of page) text += `${product.id},${product.title},${product.priceCents}\n`; yield text; } }
for await (const chunk of shape()) console.log(JSON.stringify(chunk));
