// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
function show(value: unknown): string {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null)
    return Array.isArray(value) ? "[" + value.join() + "]" : Object.prototype.toString.call(value);
  return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
function nameOfError(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return (error as Error).name;
  }
}
function cut(bytes: Uint8Array): Uint8Array {
  return bytes.slice(0, 2);
}
function cutBuffer(buffer: Buffer): Uint8Array {
  return buffer.slice(0, 2);
}
function text(bytes: Uint8Array): string {
  return bytes.toString();
}
function textOfBuffer(buffer: Buffer): string {
  return buffer.toString();
}
function find(bytes: Uint8Array, value: number): number {
  return bytes.indexOf(value);
}
function holds(bytes: Uint8Array, value: number): boolean {
  return bytes.includes(value);
}
function serialized(bytes: Uint8Array): string {
  return JSON.stringify(bytes);
}
function sharesMemory(whole: Uint8Array, part: Uint8Array): boolean {
  part[0] = 1;
  return whole[0] === 1;
}
const kinds: [string, () => Uint8Array][] = [
  ["Uint8Array", () => new Uint8Array([97, 98, 99])],
  ["Buffer.from", () => Buffer.from("abc")],
  ["Buffer.alloc", () => Buffer.alloc(3, 97)],
  ["part of a Buffer", () => Buffer.from("zabc").subarray(1)],
  ["a Uint8Array subclass", () => new (class Bytes extends Uint8Array {})([97, 98, 99])],
  ["a Uint8Array with Buffer.prototype", () => Object.setPrototypeOf(new Uint8Array([97, 98, 99]), Buffer.prototype)],
  ["a Buffer with Uint8Array.prototype", () => Object.setPrototypeOf(Buffer.from("abc"), Uint8Array.prototype)],
];
function describe(): void {
  for (const [kind, make] of kinds) {
    attempt(kind + ", text", () => text(make()) + " " + textOfBuffer(make() as Buffer));
    attempt(kind + ", slice", () => {
      const whole = make();
      return cut(whole).constructor.name + " " + sharesMemory(whole, cut(whole));
    });
    attempt(kind + ", slice as a Buffer", () => {
      const whole = make() as Buffer;
      return cutBuffer(whole).constructor.name + " " + sharesMemory(whole, cutBuffer(whole));
    });
    attempt(kind + ", search", () => find(make(), 98) + " " + holds(make(), 99) + " " + holds(make(), 1));
    attempt(kind + ", JSON", () => serialized(make()));
  }
}
describe();
describe();
export {};
