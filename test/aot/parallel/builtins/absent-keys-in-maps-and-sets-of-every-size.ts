// Maps and sets of every size from none to a few thousand keys, asked for every key that they hold and for many more that they lack: in loops,
// one call at a time, and through values of which nothing is known. Then the same after keys were deleted and added again, after a key that was
// there got a new value, after the collection was copied, cleared and filled anew, and after a key of another kind came in.
export {};

const lines: string[] = [];
function report(name: string, ...values: unknown[]) {
  lines.push(name + ": " + values.join(" "));
}

const sizes = [0, 1, 2, 4, 7, 8, 9, 10, 12, 16, 23, 24, 25, 47, 48, 49, 95, 96, 97, 190, 191, 192, 193, 253, 254, 255, 256, 383, 384, 385, 767, 768, 769, 1535, 1536, 1537, 3071, 3072, 3073];

// In loops.
function numbersHeld(set: Set<number>, from: number, to: number, step: number): number {
  let count = 0;
  for (let key = from; key < to; key += step) if (set.has(key)) count++;
  return count;
}
function numbersMapped(map: Map<number, number>, from: number, to: number, step: number): number {
  let sum = 0;
  for (let key = from; key < to; key += step) sum += map.get(key) ?? -1;
  return sum;
}
function numbersKnown(map: Map<number, number>, from: number, to: number, step: number): number {
  let count = 0;
  for (let key = from; key < to; key += step) if (map.has(key)) count++;
  return count;
}
function textsHeld(set: Set<string>, keys: string[]): number {
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (set.has(keys[i]!)) count++;
  return count;
}
function textsMapped(map: Map<string, number>, keys: string[]): number {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) sum += map.get(keys[i]!) ?? -1;
  return sum;
}
function textsMappedToTexts(map: Map<string, string>, keys: string[]): number {
  let sum = 0;
  for (let i = 0; i < keys.length; i++) sum += (map.get(keys[i]!) ?? "").length;
  return sum;
}
function objectsHeld(set: Set<object>, keys: object[]): number {
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (set.has(keys[i]!)) count++;
  return count;
}

// One call at a time: the callee is picked at run time, so no lookup stands in a loop.
const oneAtATime = {
  number: [(set: Set<number>, key: number) => set.has(key), (set: Set<number>, key: number) => !set.has(key)],
  text: [(set: Set<string>, key: string) => set.has(key), (set: Set<string>, key: string) => !set.has(key)],
  mapped: [(map: Map<number, number>, key: number) => map.get(key) ?? -1, (map: Map<number, number>, key: number) => map.get(key) ?? -2],
  mappedText: [(map: Map<string, number>, key: string) => map.get(key) ?? -1, (map: Map<string, number>, key: string) => map.get(key) ?? -2],
};
const which = lines.length;

// Through values of which nothing is known.
function heldByAnything(collection: any, keys: any[]): number {
  let count = 0;
  for (const key of keys) if (collection.has(key)) count++;
  return count;
}

const allTexts: string[] = [];
for (let i = 0; i < 8000; i++) allTexts.push("key" + i);
const allObjects: object[] = [];
for (let i = 0; i < 8000; i++) allObjects.push({ i });

function askNumbers(name: string, set: Set<number>, map: Map<number, number>, size: number, stride: number) {
  const end = (size + 40) * stride;
  let single = 0;
  let singleSum = 0;
  for (let key = -stride; key < end; key++) {
    if (oneAtATime.number[which]!(set, key)) single++;
    singleSum += oneAtATime.mapped[which]!(map, key);
  }
  report(name, set.size, map.size, numbersHeld(set, -stride, end, 1), numbersHeld(set, 0, end, stride), numbersHeld(set, 1, end, stride), numbersKnown(map, -stride, end, 1), numbersMapped(map, -stride, end, 1), numbersMapped(map, 1, end, stride), single, singleSum, numbersHeld(set, 0.5, 40, 1), set.has(NaN), set.has(-0), map.get(2 ** 40));
}

function askTexts(name: string, set: Set<string>, map: Map<string, number>, texts: Map<string, string>) {
  let single = 0;
  let singleSum = 0;
  for (let i = 0; i < allTexts.length; i += 3) {
    if (oneAtATime.text[which]!(set, allTexts[i]!)) single++;
    singleSum += oneAtATime.mappedText[which]!(map, allTexts[i]!);
  }
  report(name, set.size, map.size, textsHeld(set, allTexts), textsMapped(map, allTexts), textsMappedToTexts(texts, allTexts), single, singleSum, heldByAnything(set, allTexts), heldByAnything(map, allTexts));
}

for (const size of sizes) {
  for (const stride of [1, 3, 7]) {
    const set = new Set<number>();
    const map = new Map<number, number>();
    for (let i = 0; i < size; i++) {
      set.add(i * stride);
      map.set(i * stride, i);
    }
    askNumbers(`numbers ${size} by ${stride}`, set, map, size, stride);

    // Every third key goes and comes back, behind the others.
    for (let i = 0; i < size; i += 3) {
      set.delete(i * stride);
      map.delete(i * stride);
    }
    askNumbers(`numbers ${size} by ${stride}, a third deleted`, set, map, size, stride);
    for (let i = 0; i < size; i += 3) {
      set.add(i * stride);
      map.set(i * stride, -i);
    }
    askNumbers(`numbers ${size} by ${stride}, the third back`, set, map, size, stride);

    // New values for keys that are there add no key, however full the table is.
    for (let i = 0; i < size; i++) map.set(i * stride, i + 1);
    for (let i = 0; i < size; i++) set.add(i * stride);
    askNumbers(`numbers ${size} by ${stride}, new values`, set, map, size, stride);

    askNumbers(`numbers ${size} by ${stride}, copied`, new Set(set), new Map(map), size, stride);
    askNumbers(`numbers ${size} by ${stride}, from lists`, new Set([...set]), new Map([...map]), size, stride);

    set.clear();
    map.clear();
    askNumbers(`numbers ${size} by ${stride}, cleared`, set, map, size, stride);
    for (let i = size; i > 0; i--) {
      set.add(i * stride);
      map.set(i * stride, i);
    }
    askNumbers(`numbers ${size} by ${stride}, filled anew`, set, map, size, stride);
  }

  const set = new Set<string>();
  const map = new Map<string, number>();
  const texts = new Map<string, string>();
  for (let i = 0; i < size; i++) {
    set.add(allTexts[i * 2]!);
    map.set(allTexts[i * 2]!, i);
    texts.set(allTexts[i * 2]!, allTexts[i]!);
  }
  askTexts(`texts ${size}`, set, map, texts);
  for (let i = 0; i < size; i += 2) {
    set.delete(allTexts[i * 2]!);
    map.delete(allTexts[i * 2]!);
    texts.delete(allTexts[i * 2]!);
  }
  askTexts(`texts ${size}, half deleted`, set, map, texts);
  for (let i = 0; i < size; i += 2) {
    set.add(allTexts[i * 2]!);
    map.set(allTexts[i * 2]!, -i);
    texts.set(allTexts[i * 2]!, "");
  }
  askTexts(`texts ${size}, the half back`, set, map, texts);
  askTexts(`texts ${size}, copied`, new Set(set), new Map(map), new Map(texts));
  askTexts(`texts ${size}, from lists`, new Set([...set]), new Map([...map]), new Map([...texts]));

  // The same texts in other strings: made at run time, some of them still in two parts.
  const others: string[] = [];
  for (let i = 0; i < size + 20; i++) others.push("ke" + ("y" + i));
  report(`texts ${size}, other strings`, textsHeld(set, others), textsMapped(map, others), heldByAnything(set, others));

  // A key of another kind widens the column of the keys.
  const mixed: Set<unknown> = new Set<unknown>(set);
  const before = heldByAnything(mixed, allTexts);
  mixed.add(size + 0.5);
  mixed.add(size);
  mixed.add(null);
  mixed.add(undefined);
  mixed.add(allObjects[size]);
  report(`mixed ${size}`, mixed.size, before, heldByAnything(mixed, allTexts), heldByAnything(mixed, allObjects), heldByAnything(mixed, [size, size + 0.5, size + 1, null, undefined, true, "", NaN]));

  const objects = new Set<object>();
  for (let i = 0; i < size; i++) objects.add(allObjects[i * 2]!);
  report(`objects ${size}`, objects.size, objectsHeld(objects, allObjects), heldByAnything(objects, allObjects), heldByAnything(objects, allTexts));
}

// Collections that are written in the program, asked before and after they change.
const written = new Set<string>(["key0", "key2", "key4", "key6", "key8", "key10", "key12", "key14", "key16", "key18", "key20", "key22", "key24", "key26"]);
const writtenNumbers = new Set<number>([3, 7, 11, 19, 23, 31, 47, 59, 67, 71, 83, 97, 101, 113, 127, 131, 137, 149]);
const writtenPairs = new Map<string, number>([["key1", 1], ["key3", 3], ["key5", 5], ["key7", 7], ["key9", 9], ["key11", 11], ["key13", 13], ["key15", 15], ["key17", 17], ["key19", 19]]);
report("written", textsHeld(written, allTexts), numbersHeld(writtenNumbers, 0, 200, 1), textsMapped(writtenPairs, allTexts));
written.add("key28");
writtenNumbers.add(151);
writtenPairs.set("key21", 21);
report("written, one more", textsHeld(written, allTexts), numbersHeld(writtenNumbers, 0, 200, 1), textsMapped(writtenPairs, allTexts));
written.delete("key0");
writtenNumbers.delete(3);
writtenPairs.delete("key1");
report("written, one less", textsHeld(written, allTexts), numbersHeld(writtenNumbers, 0, 200, 1), textsMapped(writtenPairs, allTexts));

// A set that grows while it is asked: after every key that comes in, the keys around it.
const growing = new Set<number>();
let seen = 0;
for (let i = 0; i < 2000; i++) {
  growing.add(i * 5);
  seen += numbersHeld(growing, i * 5 - 12, i * 5 + 12, 1);
}
report("growing", growing.size, seen);

let digest = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
for (let i = 0; i < lines.length; i += 37) console.log(lines[i]);
console.log(lines.length, digest);
