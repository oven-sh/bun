// makes a local array of flags, sets every third and counts those that are set
const operations = 96;
let total = 0;

kernel: {
  const flags = new Array<boolean>(operations).fill(false);
  for (let i = 0; i < operations; i += 3) flags[i] = true;
  let set = 0;
  for (let i = 0; i < operations; i++) if (flags[i]) set++;
  total += set;
}

console.log(total);
