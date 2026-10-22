// 300 objects each live through 80 operations chosen by a small random number generator with a fixed seed: typed stores of small integers, hidden stores of every other kind of number and of values that are no numbers,
// ++ and +=, delete, definitions with other attributes, accessors, copies from a neighbor, undeclared properties, and at the end sometimes freeze or seal. After every operation the whole state goes into a checksum.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Trio { a = 0; b = 0; c = 0; }
function setA(trio: Trio, value: number) { trio.a = value; }
function setB(trio: Trio, value: number) { trio.b = value; }
function setC(trio: Trio, value: number) { trio.c = value; }
function bumpA(trio: Trio) { trio.a++; }
function addB(trio: Trio) { trio.b += trio.a; }
function copyC(trio: Trio, from: Trio) { trio.c = from.c; }
function sumOf(trio: Trio) { return trio.a + trio.b + trio.c; }
let seed = Number(process.argv[2] ?? 12345);
function random(below: number) {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor((seed / 2147483648) * below);
}
const names = ["a", "b", "c"];
const strangers: unknown[] = ["text", null, undefined, true, { k: 1 }];
function describe(trio: Trio) {
  const parts: string[] = [];
  for (const name of Reflect.ownKeys(trio) as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(trio, name)!;
    const value = "value" in descriptor ? descriptor.value : "accessor " + String(descriptor.get?.call(trio));
    parts.push(`${name}=${typeof value === "object" ? JSON.stringify(value) : exact(value)}${descriptor.writable === false ? "r" : ""}${descriptor.enumerable ? "" : "h"}${descriptor.configurable ? "" : "f"}`);
  }
  let total: string;
  try {
    total = exact(sumOf(trio));
  } catch (error) {
    total = (error as Error).constructor.name;
  }
  return `${parts.join(",")};${total};${JSON.stringify(trio)}`;
}
function hash(text: string, into: number) {
  for (let i = 0; i < text.length; i++) into = (Math.imul(into, 31) + text.charCodeAt(i)) | 0;
  return into;
}
function step(trio: Trio, neighbor: Trio) {
  const name = names[random(3)];
  const number = random(4) === 0 ? odd[random(odd.length)] : random(1000) - 500;
  switch (random(16)) {
    case 0: return setA(trio, random(100) | 0);
    case 1: return setB(trio, (random(100) | 0) - 50);
    case 2: return setC(trio, random(100) | 0);
    case 3: return bumpA(trio);
    case 4: return addB(trio);
    case 5: return copyC(trio, neighbor);
    case 6: return void ((trio as any)[name] = number);
    case 7: return void Reflect.set(trio, name, number);
    case 8: return void Object.assign(trio, { [name]: number });
    case 9: return void delete (trio as any)[name];
    case 10: return void Object.defineProperty(trio, name, { value: number, writable: random(4) > 0, enumerable: random(4) > 0, configurable: true });
    case 11: return void Object.defineProperty(trio, name, { get: () => number, set: undefined, enumerable: true, configurable: true });
    case 12: return void ((trio as any)[name] = strangers[random(strangers.length)]);
    case 13: return void ((trio as any)["x" + random(3)] = number);
    case 14: return setA.call(undefined, trio, number);
    default: return setC.apply(undefined, [trio, number]);
  }
}
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const trio = new Trio();
  handOver(trio);
  setA(trio, i & 15);
  setB(trio, i & 7);
  setC(trio, 3);
  bumpA(trio);
  addB(trio);
  warm += sumOf(trio);
}
console.log("warm", warm);
let neighbor = new Trio();
let checksum = 0;
let refused = 0;
for (let object = 0; object < 300; object++) {
  const trio = new Trio();
  handOver(trio);
  for (let round = 0; round < 80; round++) {
    try {
      step(trio, neighbor);
    } catch {
      refused++;
    }
    checksum = hash(describe(trio), checksum);
    if (round === 70 && object % 5 === 0) (object % 10 === 0 ? Object.freeze : Object.seal)(trio);
  }
  if (object % 25 === 0) console.log(object, checksum, refused, describe(trio));
  neighbor = trio;
}
console.log("end", checksum, refused);
