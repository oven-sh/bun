// Sorts written by hand whose inner loop looks for a place in the list and whose outer loop stores there.
function mix(hash, value) {
  return (Math.imul(hash ^ value, 16777619) + 1) | 0;
}
const shapes = {
  rising: (i, n) => i,
  falling: (i, n) => n - i,
  equal: (i, n) => 7,
  random: (i, n) => (Math.imul(i + 1, 2654435761) >>> 8) % 1000,
  fewValues: (i, n) => (Math.imul(i + 3, 40503) >>> 4) % 4,
  sawtooth: (i, n) => i % 9,
  nearlyRising: (i, n) => (i % 13 === 12 ? i - 20 : i),
  fractions: (i, n) => ((Math.imul(i + 1, 2654435761) >>> 8) % 1000) / 8,
};

function insertByBinarySearch(list) {
  for (let i = 1; i < list.length; i++) {
    const inserted = list[i];
    let low = 0;
    let high = i;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (inserted < list[middle]) high = middle;
      else low = middle + 1;
    }
    for (let j = i; j > low; j--) list[j] = list[j - 1];
    list[low] = inserted;
  }
  return list;
}

function insertRowsByBinarySearch(rows) {
  for (let i = 1; i < rows.length; i++) {
    const inserted = rows[i];
    let low = 0;
    let high = i;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (inserted.key < rows[middle].key) high = middle;
      else low = middle + 1;
    }
    for (let j = i; j > low; j--) rows[j] = rows[j - 1];
    rows[low] = inserted;
  }
  return rows;
}

function selectTheLeast(list) {
  for (let i = 0; i < list.length; i++) {
    let least = i;
    for (let j = i + 1; j < list.length; j++) if (list[j] < list[least]) least = j;
    const held = list[i];
    list[i] = list[least];
    list[least] = held;
  }
  return list;
}

function sortByHeap(list) {
  const sink = (from, end) => {
    for (let parent = from; ; ) {
      let child = 2 * parent + 1;
      if (child >= end) return;
      if (child + 1 < end && list[child + 1] > list[child]) child = child + 1;
      if (list[parent] >= list[child]) return;
      const held = list[parent];
      list[parent] = list[child];
      list[child] = held;
      parent = child;
    }
  };
  for (let from = (list.length >> 1) - 1; from >= 0; from--) sink(from, list.length);
  for (let end = list.length - 1; end > 0; end--) {
    const held = list[0];
    list[0] = list[end];
    list[end] = held;
    sink(0, end);
  }
  return list;
}

function placeOf(list, key) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (list[middle] < key) low = middle + 1;
    else high = middle;
  }
  return low;
}

const lengths = [];
for (let n = 0; n <= 40; n++) lengths.push(n);
lengths.push(63, 64, 65, 100, 257);
for (const [name, shape] of Object.entries(shapes)) {
  let hash = 0;
  for (const n of lengths) {
    const values = Array.from({ length: n }, (_, i) => shape(i, n));
    for (const sort of [insertByBinarySearch, selectTheLeast, sortByHeap])
      for (const value of sort(values.slice())) hash = mix(hash, value * 8);
    for (const row of insertRowsByBinarySearch(values.map((key, at) => ({ key, at })))) hash = mix(hash, row.at);
    const sorted = insertByBinarySearch(values.slice());
    for (let key = -2; key < 12; key++) hash = mix(hash, placeOf(sorted, key));
  }
  console.log(name, hash);
}
