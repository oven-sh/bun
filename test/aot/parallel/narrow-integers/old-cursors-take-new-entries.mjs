// A cursor that is older than its entries stores an entry and then reads it. Where the entry is null or undefined the read throws.
class Entry {
  constructor(key, next) {
    this.key = key;
    this.next = next;
    this.name = "entry " + key;
  }
}
class Cursor {
  constructor() {
    this.current = null;
    this.future = null;
    this.previous = null;
    this.steps = 0;
  }
  step(entry) {
    this.current = entry;
    this.future = entry.next;
    this.previous = null;
    this.steps++;
  }
  stepBeside(entry, other) {
    this.current = entry;
    this.future = other.next;
    this.previous = other;
    this.steps++;
  }
  stepTwice(entry, other) {
    this.previous = entry;
    this.current = entry;
    this.steps += entry.key;
    this.future = other;
    this.steps += other.key;
    this.previous = other.next;
  }
}

function births(count) {
  let total = 0;
  for (let i = 0; i < count; i++) {
    const made = new Entry(i, [i, i + 1]);
    total += made.next.length + made.name.length;
  }
  return total;
}
function chain(key) {
  return new Entry(key, new Entry(key + 1, new Entry(key + 2, null)));
}
function show(entry) {
  return entry ? `${entry.key}${entry.name}(${show(entry.next)})` : String(entry);
}

const cursor = new Cursor(),
  out = [];
births(30000);
for (let i = 0; i < 120; i++) {
  const entry = i % 7 === 3 ? undefined : i % 7 === 5 ? null : chain(i);
  const other = i % 5 === 2 ? null : i % 5 === 4 ? undefined : chain(1000 + i);
  for (const step of [() => cursor.step(entry), () => cursor.stepBeside(entry, other), () => cursor.stepTwice(entry, other)]) {
    try {
      step();
    } catch (error) {
      out.push(error.constructor.name);
    }
    births(400);
    if (i % 8 === 1) out.push(show(cursor.current), show(cursor.future), show(cursor.previous), cursor.steps);
  }
}
births(60000);
out.push(show(cursor.current), show(cursor.future), show(cursor.previous), cursor.steps);
console.log(out.join("\n"));
