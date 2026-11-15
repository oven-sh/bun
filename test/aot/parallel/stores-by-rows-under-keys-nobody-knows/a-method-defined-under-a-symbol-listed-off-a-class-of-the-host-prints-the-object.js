const listed = Object.getOwnPropertySymbols(Object.getPrototypeOf(new URL("http://example.test/")));
const shelf = { count: 0 };
for (const symbol of listed) Object.defineProperty(shelf, symbol, { value: () => "printed by the method" });
console.log(listed.length > 0, shelf);
