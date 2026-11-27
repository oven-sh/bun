function orders(items: string[]): string[] {
  if (items.length <= 1) return [items.join("")];
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of orders(rest)) out.push(items[i] + tail);
  }
  return out;
}
console.log(orders(["a", "b", "c"]).join());
