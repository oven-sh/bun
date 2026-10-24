// TypeScript gives an array of FIVE such literals one element type, { value: number | string[] | {} | null | undefined }; with
// four it keeps the union of their types.
const rows = [{ value: undefined }, { value: null }, { value: 3.14 }, { value: {} }, { value: ["hi"] }];
for (const row of rows) console.log(String(row.value));
