// Prints the bytes of sums, products and powers whose left operand is made of constants and whose right operand is known only when the program runs.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const text = () =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("")
    .slice(0, 4);
const zero = 0,
  endless = Infinity,
  two = 2,
  less = -1;
const late = Date.now() > 0 ? 1 : 2;
const row: string[] = [];
number[0] = zero / zero + late;
row.push(text());
number[0] = (zero / zero) * late;
row.push(text());
number[0] = endless - endless - late;
row.push(text());
number[0] = (endless * zero) / late;
row.push(text());
number[0] = (zero / zero) % late;
row.push(text());
number[0] = (zero / zero) ** two;
row.push(text());
number[0] = (zero / zero) ** late;
row.push(text());
number[0] = zero / zero + late + late;
row.push(text());
number[0] = late + zero / zero;
row.push(text());
number[0] = late * (zero / zero);
row.push(text());
console.log("constants", row.join(" "));
row.length = 0;
number[0] = 0 / 0 + late;
row.push(text());
number[0] = (0 / 0) * late;
row.push(text());
number[0] = Infinity - Infinity - late;
row.push(text());
number[0] = (Infinity * 0) / late;
row.push(text());
number[0] = (0 / 0) % late;
row.push(text());
number[0] = (0 / 0) ** 2;
row.push(text());
number[0] = (0 / 0) ** late;
row.push(text());
number[0] = 0 / 0 + late + late;
row.push(text());
number[0] = late + 0 / 0;
row.push(text());
number[0] = late * (0 / 0);
row.push(text());
console.log("literals", row.join(" "));
function inside() {
  const zero = 0,
    endless = Infinity,
    two = 2;
  const row: string[] = [];
  number[0] = zero / zero + late;
  row.push(text());
  number[0] = (zero / zero) * late;
  row.push(text());
  number[0] = endless - endless - late;
  row.push(text());
  number[0] = (endless * zero) / late;
  row.push(text());
  number[0] = (zero / zero) % late;
  row.push(text());
  number[0] = (zero / zero) ** two;
  row.push(text());
  number[0] = (zero / zero) ** late;
  row.push(text());
  number[0] = zero / zero + late + late;
  row.push(text());
  number[0] = late + zero / zero;
  row.push(text());
  number[0] = late * (zero / zero);
  row.push(text());
  console.log("constants of a function", row.join(" "));
}
inside();
