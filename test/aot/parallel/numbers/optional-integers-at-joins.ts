const bytes = new Uint8Array([0, 7, 255, 3]);
const words = new Int32Array([0, 7, -2147483648, 2147483647]);
const wide = new Uint32Array([4294967295, 0, 2147483648, 7]);
const text = "a\u{1F600}bc";
const seen = new Map<unknown, number>();
const list: unknown[] = [1, 2, 3];
let out = "";
function say(x: unknown): void {
  out += `${String(x)} ${typeof x} ${(x as number) + 1} ${(x as number) >>> 0} ${x ? 1 : 0} ${x === 7} ${seen.has(x)}\n`;
  seen.set(x, 1);
  list.push(x);
}
function either(i: number, flag: boolean): void {
  say(flag ? bytes[i] : 0);
  say(flag ? words[i] : 4294967295);
  say(flag ? wide[i] : undefined);
  say(flag ? text.codePointAt(i) : -2147483648);
  say(wide[i] || words[i]);
  say(bytes[i] ?? wide[3 - i]);
  let round: number | undefined = (i | 0) + 2147483647;
  for (let k = 0; k < 3; k++) if (k === (i & 1) + 1) round = wide[i];
  say(round);
  say(i > 2 ? undefined : i * 715827883);
}
for (let i = 0; i < 6; i++) {
  either(i, true);
  either(i, false);
}
console.log(out + list.length + " " + seen.size);
