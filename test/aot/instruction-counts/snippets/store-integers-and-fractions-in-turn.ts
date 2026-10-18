// stores integers and fractions in turn into a number field for which the program only shows integers
type Loose = { label: string; x?: number; y?: number; z?: number };
const operations = 100;
const loose: Loose = { label: "l" };
loose.x = loose.label.length;
loose.y = loose.label.length;
loose.z = loose.label.length;
const half: number = JSON.parse("0.5");
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) loose.y = i & 1 ? i + half : i;
  total += loose.y!;
}

console.log(total);
