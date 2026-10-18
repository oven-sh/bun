// The data that every door lets in: 64 orders, as types and as JSON text.
interface Inner { x: number; label: string }
interface Item { sku: string; quantity: number }
interface Circle { kind: "circle"; radius: number }
interface Square { kind: "square"; side: number }
interface Order { id: number; name: string; paid: boolean; price: number; tax: number; inner: Inner; items: Item[]; shape: Circle | Square; note?: string }
function textOf(i: number, undeclared: string): string {
  let items = "";
  for (let k = 0; k < 4; k++) items += (k ? "," : "") + '{"sku":"s' + k + '","quantity":' + (i + k) + "}";
  const shape = i & 2 ? '{"kind":"circle","radius":' + i + "}" : '{"kind":"square","side":' + i + "}";
  return '{"id":' + i + ',"name":"n' + i + '","paid":' + ((i & 1) === 0) + ',"price":' + (i + 0.5) + ',"tax":' + i * 0.25 + ',"inner":{"x":' + i + ',"label":"l"},"items":[' + items + '],"shape":' + shape + (i & 1 ? ',"note":"note"' : "") + undeclared + "}";
}
