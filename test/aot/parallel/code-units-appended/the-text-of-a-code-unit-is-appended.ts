function decode(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
  return text;
}
function ofNumbers(numbers: number[]): string {
  let text = "";
  for (let i = 0; i < numbers.length; i++) {
    const made = String.fromCharCode(numbers[i]!);
    if (made !== "-") text += made;
    else text += "<" + made + ">";
  }
  return text;
}
function wide(count: number): string {
  let text = "";
  for (let i = 0; i < count; i++) text += String.fromCharCode(i * 977 + 40) + String.fromCharCode(i & 127, 0x100 + i);
  return text;
}
function check(text: string): string {
  let sum = text.length;
  for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) % 1000003;
  return sum + ":" + text.length;
}
const bytes = new Uint8Array(700);
for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 255;
const odd = [65, 45, 255, 256, 65535, 65536, 65601, -1, -65471, 1.9, -1.9, NaN, Infinity, -Infinity, 4294967361, 2147483713, -2147483583, 1e21, 0, -0, 0xd83d, 0xde00];
console.log(check(decode(bytes)), check(decode(new Uint8Array(0))), check(ofNumbers(odd)), JSON.stringify(ofNumbers(odd).slice(0, 12)), check(wide(300)));
