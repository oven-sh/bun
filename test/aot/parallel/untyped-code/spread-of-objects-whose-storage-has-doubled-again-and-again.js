// The names that an object gets late lie in storage outside its cell, and that storage doubles whenever it is full. A spread copies it at once, however often it has doubled.
// Without that form every copy past sixteen words is a call: 8,249. With it the calls that are left are those for a new free list: some 400, and 777 with AddressSanitizer, whose allocators have shorter ones.
// COUNT: operation:operationAOTCopyObject <= 1000
function filled(count, seed) {
  const made = {};
  for (let i = 0; i < count; i++) made["k" + i] = seed + i;
  return made;
}
function grown(count, seed) {
  const made = { first: seed, second: "two" };
  for (let i = 0; i < count; i++) made["late" + i] = i % 3 ? seed * i : "text" + i;
  return made;
}
const copy = o => ({ ...o });
const show = o => JSON.stringify(o) + "|" + Object.keys(o).length;
let hash = 0;
const mix = text => {
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
};

// On both sides of each doubling: the cell of an ordinary object holds six names, that of a second object two, and the storage outside holds 4, 8, 16, 32, 64 and 128.
const sources = [];
for (const count of [17, 18, 19, 22, 23, 33, 34, 35, 38, 39, 65, 66, 67, 70, 71, 100, 120]) sources.push(filled(count, count * 100), grown(count, count + 1));
for (let round = 0; round < 40; round++) {
  for (const source of sources) {
    const once = copy(source);
    const twice = copy(once);
    if (round % 13 === 0) mix(show(once) + show(twice));
    // A copy has storage of its own.
    once.k16 = -1;
    once.late16 = -2;
    twice.added = round;
    delete twice.k0;
    delete twice.late0;
    if (round % 13 === 0) mix(show(source) + show(once) + show(twice));
  }
}
console.log(hash, show(sources[4]).length, show(copy(sources[33])).length);

// Copies live on when their sources are gone.
let chain = grown(40, 3);
const keptCopies = [];
for (let i = 0; i < 6000; i++) {
  chain = copy(chain);
  chain.late39 = i;
  if (i % 1500 === 0) keptCopies.push(chain);
}
console.log(show(chain).length, keptCopies.map(each => each.late39).join());
