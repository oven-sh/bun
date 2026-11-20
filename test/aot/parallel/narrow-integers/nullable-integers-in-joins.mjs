// A field of four bytes holds null or an integer. What a search answers is the field or null.
class Entry {
  constructor(key, next) {
    this.key = key;
    this.value = null;
    this.hash = key;
    this.next = next;
  }
}

const table = [null, null, null, null, null, null, null, null];
const low = [4, 5, 6, 7];

function find(key) {
  let entry = table[key & 7];
  while (entry && entry.hash !== key) entry = entry.next;
  return entry;
}
function get(key) {
  const entry = find(key);
  if (entry) return entry.value;
  return null;
}
function either(key) {
  const entry = find(key);
  return entry ? entry.value : null;
}
function literal(key) {
  const entry = find(key);
  return entry ? entry.value : 2147483647;
}
function chosen(key) {
  const first = table[key & 7],
    second = table[(key + 1) & 7];
  return key & 1 ? first.value : second.value;
}
function caught(key) {
  try {
    return find(key).value;
  } catch {
    return null;
  }
}

function look(get) {
  const seen = [];
  let sum = 0,
    product = 1,
    carried = null;
  for (let i = 0; i < 24; i++) {
    sum += get(i);
    sum -= get(i + 1);
    product = (product * (get(i) + 3)) % 1000003;
    sum += get(i) === null ? 1 : 100;
    sum += get(i) === 0 ? 1 : 100;
    sum += get(i) ? 1 : 100;
    sum += !get(i + 2) ? 1 : 100;
    sum += get(i) < 5 ? 1 : 100;
    sum += get(i) >= 0 ? 1 : 100;
    sum += get(i) | 0;
    sum += get(i) >>> 1;
    sum += -get(i) / 4;
    sum += get(i) ?? 9;
    sum += get(i) || 7;
    sum += low[get(i)] ?? 2;
    sum += Math.max(get(i), 2);
    sum += carried === get(i) ? 1 : 100;
    carried = get(i);
    seen.push(carried, typeof get(i), `${get(i)}`, Number(get(i)), JSON.stringify({ x: get(i) }));
    const entry = find(i);
    if (entry) {
      const former = entry.value;
      entry.value = get(i + 3);
      seen.push(entry.value);
      entry.value = former;
    }
  }
  return [sum, product, seen.join()].join(" ");
}
function total(count) {
  let sum = 0;
  for (let j = 0; j < 3; j++) for (let i = 0; i < count; i++) sum += get(i);
  return sum;
}

for (let i = 0; i < 20; i++) table[i & 7] = new Entry(i, table[i & 7]);
for (let i = 0; i < 20; i++) if (i % 3) find(i).value = i % 4 ? i & 255 : 0;
find(7).value = 2147483647;
for (const answer of [get, either, literal, chosen, caught]) console.log(look(answer));
console.log(total(30), total(20));
