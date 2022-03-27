const map = Bun.mmap("./mmap.txt");

function buffer_hash(buffer) {
  let hash = 0;
  for (let i = 0; i < buffer.length; i++) {
    hash = (hash << 5) - hash + buffer[i];
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

const decoder = new TextDecoder();

let hash = buffer_hash(map);
console.log(decoder.decode(map));

while (true) {
  if (buffer_hash(map) !== hash) {
    hash = buffer_hash(map);
    console.log(`mmap changed to ~> ${decoder.decode(map)}`);
  }
}
