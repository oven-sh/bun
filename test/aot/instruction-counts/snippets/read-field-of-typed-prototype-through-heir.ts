// reads a field of a typed object through an object that inherits from it
interface Parent {
  kind: string;
  size: number;
}
function parentOf(seed: number): Parent {
  return { kind: "parent", size: seed };
}
const operations = 100;
const children: any[] = [Object.create(parentOf(1)), Object.create(parentOf(2)), Object.create(parentOf(3)), Object.create(parentOf(4))];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += children[i & 3].size;
  total += sum;
}

console.log(total);
