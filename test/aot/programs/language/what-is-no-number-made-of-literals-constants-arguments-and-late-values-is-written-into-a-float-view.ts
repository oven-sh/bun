// Makes numbers that are not numbers of literals, of constants, of arguments and of values that are known only when it runs, and prints their bytes. Where a function or Math.pow raises to one half, it prints them without the sign.
const bytes = new Uint8Array(8),
  number = new Float64Array(bytes.buffer);
const text = () =>
  Array.from(bytes, byte => byte.toString(16).padStart(2, "0"))
    .reverse()
    .join("")
    .slice(0, 4) + (bytes.slice(0, 6).some(byte => byte !== 0) ? "+" : "");
const textWithoutSign = () => {
  bytes[7] &= 127;
  return text();
};
const zero = 0,
  endless = Infinity,
  less = -1,
  none = NaN,
  one = 1,
  two = 2;
const late = Date.now() > 0 ? 0 : 1;
const values: number[] = [late, late + Infinity, late - 1, late + NaN, late + 1, late + 2];
const boxes: unknown[] = [];
function made0(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return zero / zero;
}
{
  const row: string[] = [];
  number[0] = 0 / 0;
  row.push(text());
  number[0] = zero / zero;
  row.push(text());
  number[0] = made0(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made0(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 0 / 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = zero / zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made0(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("0 / 0".padEnd(28), row.join(" "));
}
function made1(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -(zero / zero);
}
{
  const row: string[] = [];
  number[0] = -(0 / 0);
  row.push(text());
  number[0] = -(zero / zero);
  row.push(text());
  number[0] = made1(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made1(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made1(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-(0 / 0)".padEnd(28), row.join(" "));
}
function made2(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return endless - endless;
}
{
  const row: string[] = [];
  number[0] = Infinity - Infinity;
  row.push(text());
  number[0] = endless - endless;
  row.push(text());
  number[0] = made2(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made2(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Infinity - Infinity;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = endless - endless;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made2(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Infinity - Infinity".padEnd(28), row.join(" "));
}
function made3(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return endless + -endless;
}
{
  const row: string[] = [];
  number[0] = Infinity + -Infinity;
  row.push(text());
  number[0] = endless + -endless;
  row.push(text());
  number[0] = made3(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made3(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Infinity + -Infinity;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = endless + -endless;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made3(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Infinity + -Infinity".padEnd(28), row.join(" "));
}
function made4(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -endless + endless;
}
{
  const row: string[] = [];
  number[0] = -Infinity + Infinity;
  row.push(text());
  number[0] = -endless + endless;
  row.push(text());
  number[0] = made4(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made4(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -Infinity + Infinity;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -endless + endless;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made4(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-Infinity + Infinity".padEnd(28), row.join(" "));
}
function made5(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return endless * zero;
}
{
  const row: string[] = [];
  number[0] = Infinity * 0;
  row.push(text());
  number[0] = endless * zero;
  row.push(text());
  number[0] = made5(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made5(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Infinity * 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = endless * zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made5(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Infinity * 0".padEnd(28), row.join(" "));
}
function made6(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return zero * endless;
}
{
  const row: string[] = [];
  number[0] = 0 * Infinity;
  row.push(text());
  number[0] = zero * endless;
  row.push(text());
  number[0] = made6(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made6(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 0 * Infinity;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = zero * endless;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made6(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("0 * Infinity".padEnd(28), row.join(" "));
}
function made7(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -endless * zero;
}
{
  const row: string[] = [];
  number[0] = -Infinity * 0;
  row.push(text());
  number[0] = -endless * zero;
  row.push(text());
  number[0] = made7(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made7(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -Infinity * 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -endless * zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made7(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-Infinity * 0".padEnd(28), row.join(" "));
}
function made8(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return endless / endless;
}
{
  const row: string[] = [];
  number[0] = Infinity / Infinity;
  row.push(text());
  number[0] = endless / endless;
  row.push(text());
  number[0] = made8(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made8(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Infinity / Infinity;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = endless / endless;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made8(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Infinity / Infinity".padEnd(28), row.join(" "));
}
function made9(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -endless / endless;
}
{
  const row: string[] = [];
  number[0] = -Infinity / Infinity;
  row.push(text());
  number[0] = -endless / endless;
  row.push(text());
  number[0] = made9(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made9(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -Infinity / Infinity;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -endless / endless;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made9(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-Infinity / Infinity".padEnd(28), row.join(" "));
}
function made10(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return zero % zero;
}
{
  const row: string[] = [];
  number[0] = 0 % 0;
  row.push(text());
  number[0] = zero % zero;
  row.push(text());
  number[0] = made10(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made10(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 0 % 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = zero % zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made10(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("0 % 0".padEnd(28), row.join(" "));
}
function made11(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return one % zero;
}
{
  const row: string[] = [];
  number[0] = 1 % 0;
  row.push(text());
  number[0] = one % zero;
  row.push(text());
  number[0] = made11(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made11(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1 % 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = one % zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made11(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1 % 0".padEnd(28), row.join(" "));
}
function made12(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return less % zero;
}
{
  const row: string[] = [];
  number[0] = -1 % 0;
  row.push(text());
  number[0] = less % zero;
  row.push(text());
  number[0] = made12(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made12(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -1 % 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = less % zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made12(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(-1) % 0".padEnd(28), row.join(" "));
}
function made13(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return endless % one;
}
{
  const row: string[] = [];
  number[0] = Infinity % 1;
  row.push(text());
  number[0] = endless % one;
  row.push(text());
  number[0] = made13(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made13(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Infinity % 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = endless % one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made13(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Infinity % 1".padEnd(28), row.join(" "));
}
function made14(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -endless % one;
}
{
  const row: string[] = [];
  number[0] = -Infinity % 1;
  row.push(text());
  number[0] = -endless % one;
  row.push(text());
  number[0] = made14(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made14(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -Infinity % 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -endless % one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made14(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-Infinity % 1".padEnd(28), row.join(" "));
}
function made15(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return 1.5 % zero;
}
{
  const row: string[] = [];
  number[0] = 1.5 % 0;
  row.push(text());
  number[0] = 1.5 % zero;
  row.push(text());
  number[0] = made15(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made15(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1.5 % 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = 1.5 % zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made15(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1.5 % 0".padEnd(28), row.join(" "));
}
function made16(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return zero % none;
}
{
  const row: string[] = [];
  number[0] = 0 % NaN;
  row.push(text());
  number[0] = zero % none;
  row.push(text());
  number[0] = made16(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made16(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 0 % NaN;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = zero % none;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made16(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("0 % NaN".padEnd(28), row.join(" "));
}
function made17(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return none % one;
}
{
  const row: string[] = [];
  number[0] = NaN % 1;
  row.push(text());
  number[0] = none % one;
  row.push(text());
  number[0] = made17(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made17(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = NaN % 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = none % one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made17(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("NaN % 1".padEnd(28), row.join(" "));
}
function made18(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.sqrt(less);
}
{
  const row: string[] = [];
  number[0] = Math.sqrt(-1);
  row.push(text());
  number[0] = Math.sqrt(less);
  row.push(text());
  number[0] = made18(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made18(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.sqrt(-1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.sqrt(less);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made18(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.sqrt((-1))".padEnd(28), row.join(" "));
}
function made19(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return less ** 0.5;
}
{
  const row: string[] = [];
  number[0] = (-1) ** 0.5;
  row.push(text());
  number[0] = less ** 0.5;
  row.push(text());
  number[0] = made19(0, Infinity, -1, NaN, 1, 2);
  row.push(textWithoutSign());
  number[0] = made19(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(textWithoutSign());
  boxes[0] = (-1) ** 0.5;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = less ** 0.5;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made19(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(textWithoutSign());
  console.log("(-1) ** 0.5".padEnd(28), row.join(" "));
}
function made20(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.pow(less, 0.5);
}
{
  const row: string[] = [];
  number[0] = Math.pow(-1, 0.5);
  row.push(textWithoutSign());
  number[0] = Math.pow(less, 0.5);
  row.push(textWithoutSign());
  number[0] = made20(0, Infinity, -1, NaN, 1, 2);
  row.push(textWithoutSign());
  number[0] = made20(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(textWithoutSign());
  boxes[0] = Math.pow(-1, 0.5);
  number[0] = boxes[0] as number;
  row.push(textWithoutSign());
  boxes[0] = Math.pow(less, 0.5);
  number[0] = boxes[0] as number;
  row.push(textWithoutSign());
  boxes[0] = made20(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(textWithoutSign());
  console.log("Math.pow((-1), 0.5)".padEnd(28), row.join(" "));
}
function made21(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.pow(one, endless);
}
{
  const row: string[] = [];
  number[0] = Math.pow(1, Infinity);
  row.push(text());
  number[0] = Math.pow(one, endless);
  row.push(text());
  number[0] = made21(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made21(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.pow(1, Infinity);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.pow(one, endless);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made21(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.pow(1, Infinity)".padEnd(28), row.join(" "));
}
function made22(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return one ** endless;
}
{
  const row: string[] = [];
  number[0] = 1 ** Infinity;
  row.push(text());
  number[0] = one ** endless;
  row.push(text());
  number[0] = made22(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made22(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1 ** Infinity;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = one ** endless;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made22(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1 ** Infinity".padEnd(28), row.join(" "));
}
function made23(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.pow(one, none);
}
{
  const row: string[] = [];
  number[0] = Math.pow(1, NaN);
  row.push(text());
  number[0] = Math.pow(one, none);
  row.push(text());
  number[0] = made23(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made23(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.pow(1, NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.pow(one, none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made23(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.pow(1, NaN)".padEnd(28), row.join(" "));
}
function made24(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.log(less);
}
{
  const row: string[] = [];
  number[0] = Math.log(-1);
  row.push(text());
  number[0] = Math.log(less);
  row.push(text());
  number[0] = made24(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made24(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.log(-1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.log(less);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made24(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.log((-1))".padEnd(28), row.join(" "));
}
function made25(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.log2(less);
}
{
  const row: string[] = [];
  number[0] = Math.log2(-1);
  row.push(text());
  number[0] = Math.log2(less);
  row.push(text());
  number[0] = made25(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made25(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.log2(-1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.log2(less);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made25(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.log2((-1))".padEnd(28), row.join(" "));
}
function made26(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.log10(less);
}
{
  const row: string[] = [];
  number[0] = Math.log10(-1);
  row.push(text());
  number[0] = Math.log10(less);
  row.push(text());
  number[0] = made26(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made26(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.log10(-1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.log10(less);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made26(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.log10((-1))".padEnd(28), row.join(" "));
}
function made27(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.log1p(-two);
}
{
  const row: string[] = [];
  number[0] = Math.log1p(-2);
  row.push(text());
  number[0] = Math.log1p(-two);
  row.push(text());
  number[0] = made27(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made27(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.log1p(-2);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.log1p(-two);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made27(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.log1p(-2)".padEnd(28), row.join(" "));
}
function made28(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.acos(two);
}
{
  const row: string[] = [];
  number[0] = Math.acos(2);
  row.push(text());
  number[0] = Math.acos(two);
  row.push(text());
  number[0] = made28(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made28(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.acos(2);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.acos(two);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made28(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.acos(2)".padEnd(28), row.join(" "));
}
function made29(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.asin(two);
}
{
  const row: string[] = [];
  number[0] = Math.asin(2);
  row.push(text());
  number[0] = Math.asin(two);
  row.push(text());
  number[0] = made29(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made29(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.asin(2);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.asin(two);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made29(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.asin(2)".padEnd(28), row.join(" "));
}
function made30(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.acosh(zero);
}
{
  const row: string[] = [];
  number[0] = Math.acosh(0);
  row.push(text());
  number[0] = Math.acosh(zero);
  row.push(text());
  number[0] = made30(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made30(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.acosh(0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.acosh(zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made30(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.acosh(0)".padEnd(28), row.join(" "));
}
function made31(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.atanh(two);
}
{
  const row: string[] = [];
  number[0] = Math.atanh(2);
  row.push(text());
  number[0] = Math.atanh(two);
  row.push(text());
  number[0] = made31(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made31(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.atanh(2);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.atanh(two);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made31(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.atanh(2)".padEnd(28), row.join(" "));
}
function made32(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.sin(endless);
}
{
  const row: string[] = [];
  number[0] = Math.sin(Infinity);
  row.push(text());
  number[0] = Math.sin(endless);
  row.push(text());
  number[0] = made32(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made32(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.sin(Infinity);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.sin(endless);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made32(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.sin(Infinity)".padEnd(28), row.join(" "));
}
function made33(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.cos(endless);
}
{
  const row: string[] = [];
  number[0] = Math.cos(Infinity);
  row.push(text());
  number[0] = Math.cos(endless);
  row.push(text());
  number[0] = made33(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made33(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.cos(Infinity);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.cos(endless);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made33(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.cos(Infinity)".padEnd(28), row.join(" "));
}
function made34(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.tan(endless);
}
{
  const row: string[] = [];
  number[0] = Math.tan(Infinity);
  row.push(text());
  number[0] = Math.tan(endless);
  row.push(text());
  number[0] = made34(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made34(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.tan(Infinity);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.tan(endless);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made34(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.tan(Infinity)".padEnd(28), row.join(" "));
}
function made35(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.atan2(none, one);
}
{
  const row: string[] = [];
  number[0] = Math.atan2(NaN, 1);
  row.push(text());
  number[0] = Math.atan2(none, one);
  row.push(text());
  number[0] = made35(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made35(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.atan2(NaN, 1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.atan2(none, one);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made35(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.atan2(NaN, 1)".padEnd(28), row.join(" "));
}
function made36(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.exp(none);
}
{
  const row: string[] = [];
  number[0] = Math.exp(NaN);
  row.push(text());
  number[0] = Math.exp(none);
  row.push(text());
  number[0] = made36(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made36(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.exp(NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.exp(none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made36(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.exp(NaN)".padEnd(28), row.join(" "));
}
function made37(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.expm1(none);
}
{
  const row: string[] = [];
  number[0] = Math.expm1(NaN);
  row.push(text());
  number[0] = Math.expm1(none);
  row.push(text());
  number[0] = made37(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made37(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.expm1(NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.expm1(none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made37(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.expm1(NaN)".padEnd(28), row.join(" "));
}
function made38(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.cbrt(none);
}
{
  const row: string[] = [];
  number[0] = Math.cbrt(NaN);
  row.push(text());
  number[0] = Math.cbrt(none);
  row.push(text());
  number[0] = made38(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made38(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.cbrt(NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.cbrt(none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made38(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.cbrt(NaN)".padEnd(28), row.join(" "));
}
function made39(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.sinh(none);
}
{
  const row: string[] = [];
  number[0] = Math.sinh(NaN);
  row.push(text());
  number[0] = Math.sinh(none);
  row.push(text());
  number[0] = made39(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made39(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.sinh(NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.sinh(none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made39(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.sinh(NaN)".padEnd(28), row.join(" "));
}
function made40(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.tanh(none);
}
{
  const row: string[] = [];
  number[0] = Math.tanh(NaN);
  row.push(text());
  number[0] = Math.tanh(none);
  row.push(text());
  number[0] = made40(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made40(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.tanh(NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.tanh(none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made40(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.tanh(NaN)".padEnd(28), row.join(" "));
}
function made41(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.abs(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.abs(0 / 0);
  row.push(text());
  number[0] = Math.abs(zero / zero);
  row.push(text());
  number[0] = made41(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made41(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.abs(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.abs(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made41(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.abs(0 / 0)".padEnd(28), row.join(" "));
}
function made42(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.abs(none);
}
{
  const row: string[] = [];
  number[0] = Math.abs(NaN);
  row.push(text());
  number[0] = Math.abs(none);
  row.push(text());
  number[0] = made42(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made42(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.abs(NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.abs(none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made42(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.abs(NaN)".padEnd(28), row.join(" "));
}
function made43(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.fround(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.fround(0 / 0);
  row.push(text());
  number[0] = Math.fround(zero / zero);
  row.push(text());
  number[0] = made43(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made43(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.fround(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.fround(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made43(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.fround(0 / 0)".padEnd(28), row.join(" "));
}
function made44(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.fround(none);
}
{
  const row: string[] = [];
  number[0] = Math.fround(NaN);
  row.push(text());
  number[0] = Math.fround(none);
  row.push(text());
  number[0] = made44(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made44(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.fround(NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.fround(none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made44(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.fround(NaN)".padEnd(28), row.join(" "));
}
function made45(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.f16round(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.f16round(0 / 0);
  row.push(text());
  number[0] = Math.f16round(zero / zero);
  row.push(text());
  number[0] = made45(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made45(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.f16round(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.f16round(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made45(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.f16round(0 / 0)".padEnd(28), row.join(" "));
}
function made46(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.floor(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.floor(0 / 0);
  row.push(text());
  number[0] = Math.floor(zero / zero);
  row.push(text());
  number[0] = made46(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made46(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.floor(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.floor(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made46(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.floor(0 / 0)".padEnd(28), row.join(" "));
}
function made47(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.ceil(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.ceil(0 / 0);
  row.push(text());
  number[0] = Math.ceil(zero / zero);
  row.push(text());
  number[0] = made47(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made47(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.ceil(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.ceil(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made47(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.ceil(0 / 0)".padEnd(28), row.join(" "));
}
function made48(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.round(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.round(0 / 0);
  row.push(text());
  number[0] = Math.round(zero / zero);
  row.push(text());
  number[0] = made48(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made48(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.round(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.round(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made48(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.round(0 / 0)".padEnd(28), row.join(" "));
}
function made49(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.trunc(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.trunc(0 / 0);
  row.push(text());
  number[0] = Math.trunc(zero / zero);
  row.push(text());
  number[0] = made49(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made49(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.trunc(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.trunc(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made49(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.trunc(0 / 0)".padEnd(28), row.join(" "));
}
function made50(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.sign(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.sign(0 / 0);
  row.push(text());
  number[0] = Math.sign(zero / zero);
  row.push(text());
  number[0] = made50(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made50(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.sign(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.sign(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made50(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.sign(0 / 0)".padEnd(28), row.join(" "));
}
function made51(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.min(zero / zero, one);
}
{
  const row: string[] = [];
  number[0] = Math.min(0 / 0, 1);
  row.push(text());
  number[0] = Math.min(zero / zero, one);
  row.push(text());
  number[0] = made51(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made51(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.min(0 / 0, 1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.min(zero / zero, one);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made51(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.min(0 / 0, 1)".padEnd(28), row.join(" "));
}
function made52(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.max(one, zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.max(1, 0 / 0);
  row.push(text());
  number[0] = Math.max(one, zero / zero);
  row.push(text());
  number[0] = made52(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made52(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.max(1, 0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.max(one, zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made52(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.max(1, 0 / 0)".padEnd(28), row.join(" "));
}
function made53(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.min(none, one);
}
{
  const row: string[] = [];
  number[0] = Math.min(NaN, 1);
  row.push(text());
  number[0] = Math.min(none, one);
  row.push(text());
  number[0] = made53(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made53(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.min(NaN, 1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.min(none, one);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made53(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.min(NaN, 1)".padEnd(28), row.join(" "));
}
function made54(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.max(one, none);
}
{
  const row: string[] = [];
  number[0] = Math.max(1, NaN);
  row.push(text());
  number[0] = Math.max(one, none);
  row.push(text());
  number[0] = made54(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made54(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.max(1, NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.max(one, none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made54(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.max(1, NaN)".padEnd(28), row.join(" "));
}
function made55(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.hypot(zero / zero, one);
}
{
  const row: string[] = [];
  number[0] = Math.hypot(0 / 0, 1);
  row.push(text());
  number[0] = Math.hypot(zero / zero, one);
  row.push(text());
  number[0] = made55(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made55(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.hypot(0 / 0, 1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.hypot(zero / zero, one);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made55(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.hypot(0 / 0, 1)".padEnd(28), row.join(" "));
}
function made56(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.hypot(none, one);
}
{
  const row: string[] = [];
  number[0] = Math.hypot(NaN, 1);
  row.push(text());
  number[0] = Math.hypot(none, one);
  row.push(text());
  number[0] = made56(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made56(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.hypot(NaN, 1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.hypot(none, one);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made56(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.hypot(NaN, 1)".padEnd(28), row.join(" "));
}
function made57(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return none;
}
{
  const row: string[] = [];
  number[0] = NaN;
  row.push(text());
  number[0] = none;
  row.push(text());
  number[0] = made57(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made57(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = NaN;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = none;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made57(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("NaN".padEnd(28), row.join(" "));
}
function made58(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -none;
}
{
  const row: string[] = [];
  number[0] = -NaN;
  row.push(text());
  number[0] = -none;
  row.push(text());
  number[0] = made58(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made58(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -NaN;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -none;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made58(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-NaN".padEnd(28), row.join(" "));
}
function made59(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -(-none);
}
{
  const row: string[] = [];
  number[0] = -(-NaN);
  row.push(text());
  number[0] = -(-none);
  row.push(text());
  number[0] = made59(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made59(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -(-NaN);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -(-none);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made59(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("- -NaN".padEnd(28), row.join(" "));
}
function made60(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return none + one;
}
{
  const row: string[] = [];
  number[0] = NaN + 1;
  row.push(text());
  number[0] = none + one;
  row.push(text());
  number[0] = made60(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made60(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = NaN + 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = none + one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made60(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("NaN + 1".padEnd(28), row.join(" "));
}
function made61(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return one + none;
}
{
  const row: string[] = [];
  number[0] = 1 + NaN;
  row.push(text());
  number[0] = one + none;
  row.push(text());
  number[0] = made61(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made61(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1 + NaN;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = one + none;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made61(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1 + NaN".padEnd(28), row.join(" "));
}
function made62(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return none - one;
}
{
  const row: string[] = [];
  number[0] = NaN - 1;
  row.push(text());
  number[0] = none - one;
  row.push(text());
  number[0] = made62(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made62(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = NaN - 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = none - one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made62(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("NaN - 1".padEnd(28), row.join(" "));
}
function made63(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return one - none;
}
{
  const row: string[] = [];
  number[0] = 1 - NaN;
  row.push(text());
  number[0] = one - none;
  row.push(text());
  number[0] = made63(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made63(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1 - NaN;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = one - none;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made63(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1 - NaN".padEnd(28), row.join(" "));
}
function made64(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return none * two;
}
{
  const row: string[] = [];
  number[0] = NaN * 2;
  row.push(text());
  number[0] = none * two;
  row.push(text());
  number[0] = made64(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made64(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = NaN * 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = none * two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made64(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("NaN * 2".padEnd(28), row.join(" "));
}
function made65(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return none / two;
}
{
  const row: string[] = [];
  number[0] = NaN / 2;
  row.push(text());
  number[0] = none / two;
  row.push(text());
  number[0] = made65(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made65(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = NaN / 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = none / two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made65(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("NaN / 2".padEnd(28), row.join(" "));
}
function made66(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return two / none;
}
{
  const row: string[] = [];
  number[0] = 2 / NaN;
  row.push(text());
  number[0] = two / none;
  row.push(text());
  number[0] = made66(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made66(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 2 / NaN;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = two / none;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made66(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("2 / NaN".padEnd(28), row.join(" "));
}
function made67(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -none + one;
}
{
  const row: string[] = [];
  number[0] = -NaN + 1;
  row.push(text());
  number[0] = -none + one;
  row.push(text());
  number[0] = made67(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made67(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -NaN + 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -none + one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made67(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-NaN + 1".padEnd(28), row.join(" "));
}
function made68(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -none * two;
}
{
  const row: string[] = [];
  number[0] = -NaN * 2;
  row.push(text());
  number[0] = -none * two;
  row.push(text());
  number[0] = made68(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made68(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -NaN * 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -none * two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made68(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-NaN * 2".padEnd(28), row.join(" "));
}
function made69(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return zero / zero - zero / zero;
}
{
  const row: string[] = [];
  number[0] = 0 / 0 - 0 / 0;
  row.push(text());
  number[0] = zero / zero - zero / zero;
  row.push(text());
  number[0] = made69(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made69(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 0 / 0 - 0 / 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = zero / zero - zero / zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made69(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(0 / 0) - (0 / 0)".padEnd(28), row.join(" "));
}
function made70(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.sqrt(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.sqrt(0 / 0);
  row.push(text());
  number[0] = Math.sqrt(zero / zero);
  row.push(text());
  number[0] = made70(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made70(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.sqrt(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.sqrt(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made70(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.sqrt(0 / 0)".padEnd(28), row.join(" "));
}
function made71(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.log(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.log(0 / 0);
  row.push(text());
  number[0] = Math.log(zero / zero);
  row.push(text());
  number[0] = made71(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made71(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.log(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.log(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made71(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.log(0 / 0)".padEnd(28), row.join(" "));
}
function made72(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.sin(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.sin(0 / 0);
  row.push(text());
  number[0] = Math.sin(zero / zero);
  row.push(text());
  number[0] = made72(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made72(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.sin(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.sin(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made72(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.sin(0 / 0)".padEnd(28), row.join(" "));
}
function made73(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.exp(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.exp(0 / 0);
  row.push(text());
  number[0] = Math.exp(zero / zero);
  row.push(text());
  number[0] = made73(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made73(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.exp(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.exp(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made73(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.exp(0 / 0)".padEnd(28), row.join(" "));
}
function made74(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.cbrt(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.cbrt(0 / 0);
  row.push(text());
  number[0] = Math.cbrt(zero / zero);
  row.push(text());
  number[0] = made74(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made74(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.cbrt(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.cbrt(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made74(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.cbrt(0 / 0)".padEnd(28), row.join(" "));
}
function made75(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.atan2(zero / zero, one);
}
{
  const row: string[] = [];
  number[0] = Math.atan2(0 / 0, 1);
  row.push(text());
  number[0] = Math.atan2(zero / zero, one);
  row.push(text());
  number[0] = made75(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made75(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.atan2(0 / 0, 1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.atan2(zero / zero, one);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made75(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.atan2(0 / 0, 1)".padEnd(28), row.join(" "));
}
function made76(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.atan2(one, zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.atan2(1, 0 / 0);
  row.push(text());
  number[0] = Math.atan2(one, zero / zero);
  row.push(text());
  number[0] = made76(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made76(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.atan2(1, 0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.atan2(one, zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made76(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.atan2(1, 0 / 0)".padEnd(28), row.join(" "));
}
function made77(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.pow(zero / zero, two);
}
{
  const row: string[] = [];
  number[0] = Math.pow(0 / 0, 2);
  row.push(text());
  number[0] = Math.pow(zero / zero, two);
  row.push(text());
  number[0] = made77(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made77(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.pow(0 / 0, 2);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.pow(zero / zero, two);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made77(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.pow(0 / 0, 2)".padEnd(28), row.join(" "));
}
function made78(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.pow(two, zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.pow(2, 0 / 0);
  row.push(text());
  number[0] = Math.pow(two, zero / zero);
  row.push(text());
  number[0] = made78(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made78(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.pow(2, 0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.pow(two, zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made78(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.pow(2, 0 / 0)".padEnd(28), row.join(" "));
}
function made79(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return (zero / zero) ** two;
}
{
  const row: string[] = [];
  number[0] = (0 / 0) ** 2;
  row.push(text());
  number[0] = (zero / zero) ** two;
  row.push(text());
  number[0] = made79(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made79(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = (0 / 0) ** 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = (zero / zero) ** two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made79(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(0 / 0) ** 2".padEnd(28), row.join(" "));
}
function made80(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return two ** (zero / zero);
}
{
  const row: string[] = [];
  number[0] = 2 ** (0 / 0);
  row.push(text());
  number[0] = two ** (zero / zero);
  row.push(text());
  number[0] = made80(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made80(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 2 ** (0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = two ** (zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made80(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("2 ** (0 / 0)".padEnd(28), row.join(" "));
}
function made81(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return (zero / zero) % one;
}
{
  const row: string[] = [];
  number[0] = (0 / 0) % 1;
  row.push(text());
  number[0] = (zero / zero) % one;
  row.push(text());
  number[0] = made81(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made81(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = (0 / 0) % 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = (zero / zero) % one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made81(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(0 / 0) % 1".padEnd(28), row.join(" "));
}
function made82(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return one % (zero / zero);
}
{
  const row: string[] = [];
  number[0] = 1 % (0 / 0);
  row.push(text());
  number[0] = one % (zero / zero);
  row.push(text());
  number[0] = made82(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made82(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1 % (0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = one % (zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made82(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1 % (0 / 0)".padEnd(28), row.join(" "));
}
function made83(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return zero / zero - one;
}
{
  const row: string[] = [];
  number[0] = 0 / 0 - 1;
  row.push(text());
  number[0] = zero / zero - one;
  row.push(text());
  number[0] = made83(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made83(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 0 / 0 - 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = zero / zero - one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made83(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(0 / 0) - 1".padEnd(28), row.join(" "));
}
function made84(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return one / (zero / zero);
}
{
  const row: string[] = [];
  number[0] = 1 / (0 / 0);
  row.push(text());
  number[0] = one / (zero / zero);
  row.push(text());
  number[0] = made84(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made84(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1 / (0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = one / (zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made84(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1 / (0 / 0)".padEnd(28), row.join(" "));
}
function made85(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.log1p(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.log1p(0 / 0);
  row.push(text());
  number[0] = Math.log1p(zero / zero);
  row.push(text());
  number[0] = made85(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made85(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.log1p(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.log1p(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made85(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.log1p(0 / 0)".padEnd(28), row.join(" "));
}
function made86(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.expm1(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.expm1(0 / 0);
  row.push(text());
  number[0] = Math.expm1(zero / zero);
  row.push(text());
  number[0] = made86(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made86(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.expm1(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.expm1(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made86(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.expm1(0 / 0)".padEnd(28), row.join(" "));
}
function made87(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.tanh(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.tanh(0 / 0);
  row.push(text());
  number[0] = Math.tanh(zero / zero);
  row.push(text());
  number[0] = made87(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made87(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.tanh(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.tanh(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made87(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.tanh(0 / 0)".padEnd(28), row.join(" "));
}
function made88(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.asinh(zero / zero);
}
{
  const row: string[] = [];
  number[0] = Math.asinh(0 / 0);
  row.push(text());
  number[0] = Math.asinh(zero / zero);
  row.push(text());
  number[0] = made88(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made88(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.asinh(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.asinh(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made88(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.asinh(0 / 0)".padEnd(28), row.join(" "));
}
function made89(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.clz32(zero / zero) / zero;
}
{
  const row: string[] = [];
  number[0] = Math.clz32(0 / 0) / 0;
  row.push(text());
  number[0] = Math.clz32(zero / zero) / zero;
  row.push(text());
  number[0] = made89(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made89(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.clz32(0 / 0) / 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.clz32(zero / zero) / zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made89(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.clz32(0 / 0) / 0".padEnd(28), row.join(" "));
}
function made90(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.sqrt(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.sqrt(-(0 / 0));
  row.push(text());
  number[0] = Math.sqrt(-(zero / zero));
  row.push(text());
  number[0] = made90(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made90(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.sqrt(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.sqrt(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made90(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.sqrt(-(0 / 0))".padEnd(28), row.join(" "));
}
function made91(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.log(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.log(-(0 / 0));
  row.push(text());
  number[0] = Math.log(-(zero / zero));
  row.push(text());
  number[0] = made91(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made91(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.log(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.log(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made91(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.log(-(0 / 0))".padEnd(28), row.join(" "));
}
function made92(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.sin(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.sin(-(0 / 0));
  row.push(text());
  number[0] = Math.sin(-(zero / zero));
  row.push(text());
  number[0] = made92(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made92(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.sin(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.sin(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made92(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.sin(-(0 / 0))".padEnd(28), row.join(" "));
}
function made93(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.exp(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.exp(-(0 / 0));
  row.push(text());
  number[0] = Math.exp(-(zero / zero));
  row.push(text());
  number[0] = made93(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made93(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.exp(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.exp(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made93(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.exp(-(0 / 0))".padEnd(28), row.join(" "));
}
function made94(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.cbrt(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.cbrt(-(0 / 0));
  row.push(text());
  number[0] = Math.cbrt(-(zero / zero));
  row.push(text());
  number[0] = made94(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made94(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.cbrt(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.cbrt(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made94(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.cbrt(-(0 / 0))".padEnd(28), row.join(" "));
}
function made95(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.atan2(-(zero / zero), one);
}
{
  const row: string[] = [];
  number[0] = Math.atan2(-(0 / 0), 1);
  row.push(text());
  number[0] = Math.atan2(-(zero / zero), one);
  row.push(text());
  number[0] = made95(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made95(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.atan2(-(0 / 0), 1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.atan2(-(zero / zero), one);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made95(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.atan2(-(0 / 0), 1)".padEnd(28), row.join(" "));
}
function made96(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.atan2(one, -(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.atan2(1, -(0 / 0));
  row.push(text());
  number[0] = Math.atan2(one, -(zero / zero));
  row.push(text());
  number[0] = made96(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made96(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.atan2(1, -(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.atan2(one, -(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made96(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.atan2(1, -(0 / 0))".padEnd(28), row.join(" "));
}
function made97(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.pow(-(zero / zero), two);
}
{
  const row: string[] = [];
  number[0] = Math.pow(-(0 / 0), 2);
  row.push(text());
  number[0] = Math.pow(-(zero / zero), two);
  row.push(text());
  number[0] = made97(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made97(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.pow(-(0 / 0), 2);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.pow(-(zero / zero), two);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made97(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.pow(-(0 / 0), 2)".padEnd(28), row.join(" "));
}
function made98(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.pow(two, -(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.pow(2, -(0 / 0));
  row.push(text());
  number[0] = Math.pow(two, -(zero / zero));
  row.push(text());
  number[0] = made98(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made98(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.pow(2, -(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.pow(two, -(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made98(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.pow(2, -(0 / 0))".padEnd(28), row.join(" "));
}
function made99(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return (-(zero / zero)) ** two;
}
{
  const row: string[] = [];
  number[0] = (-(0 / 0)) ** 2;
  row.push(text());
  number[0] = (-(zero / zero)) ** two;
  row.push(text());
  number[0] = made99(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made99(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = (-(0 / 0)) ** 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = (-(zero / zero)) ** two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made99(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(-(0 / 0)) ** 2".padEnd(28), row.join(" "));
}
function made100(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return two ** -(zero / zero);
}
{
  const row: string[] = [];
  number[0] = 2 ** -(0 / 0);
  row.push(text());
  number[0] = two ** -(zero / zero);
  row.push(text());
  number[0] = made100(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made100(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 2 ** -(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = two ** -(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made100(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("2 ** (-(0 / 0))".padEnd(28), row.join(" "));
}
function made101(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -(zero / zero) % one;
}
{
  const row: string[] = [];
  number[0] = -(0 / 0) % 1;
  row.push(text());
  number[0] = -(zero / zero) % one;
  row.push(text());
  number[0] = made101(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made101(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -(0 / 0) % 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -(zero / zero) % one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made101(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(-(0 / 0)) % 1".padEnd(28), row.join(" "));
}
function made102(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return one % -(zero / zero);
}
{
  const row: string[] = [];
  number[0] = 1 % -(0 / 0);
  row.push(text());
  number[0] = one % -(zero / zero);
  row.push(text());
  number[0] = made102(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made102(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1 % -(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = one % -(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made102(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1 % (-(0 / 0))".padEnd(28), row.join(" "));
}
function made103(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -(zero / zero) - one;
}
{
  const row: string[] = [];
  number[0] = -(0 / 0) - 1;
  row.push(text());
  number[0] = -(zero / zero) - one;
  row.push(text());
  number[0] = made103(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made103(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -(0 / 0) - 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -(zero / zero) - one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made103(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(-(0 / 0)) - 1".padEnd(28), row.join(" "));
}
function made104(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return one / -(zero / zero);
}
{
  const row: string[] = [];
  number[0] = 1 / -(0 / 0);
  row.push(text());
  number[0] = one / -(zero / zero);
  row.push(text());
  number[0] = made104(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made104(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1 / -(0 / 0);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = one / -(zero / zero);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made104(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1 / (-(0 / 0))".padEnd(28), row.join(" "));
}
function made105(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.log1p(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.log1p(-(0 / 0));
  row.push(text());
  number[0] = Math.log1p(-(zero / zero));
  row.push(text());
  number[0] = made105(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made105(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.log1p(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.log1p(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made105(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.log1p(-(0 / 0))".padEnd(28), row.join(" "));
}
function made106(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.expm1(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.expm1(-(0 / 0));
  row.push(text());
  number[0] = Math.expm1(-(zero / zero));
  row.push(text());
  number[0] = made106(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made106(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.expm1(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.expm1(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made106(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.expm1(-(0 / 0))".padEnd(28), row.join(" "));
}
function made107(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.tanh(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.tanh(-(0 / 0));
  row.push(text());
  number[0] = Math.tanh(-(zero / zero));
  row.push(text());
  number[0] = made107(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made107(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.tanh(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.tanh(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made107(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.tanh(-(0 / 0))".padEnd(28), row.join(" "));
}
function made108(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.asinh(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.asinh(-(0 / 0));
  row.push(text());
  number[0] = Math.asinh(-(zero / zero));
  row.push(text());
  number[0] = made108(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made108(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.asinh(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.asinh(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made108(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.asinh(-(0 / 0))".padEnd(28), row.join(" "));
}
function made109(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.clz32(-(zero / zero)) / zero;
}
{
  const row: string[] = [];
  number[0] = Math.clz32(-(0 / 0)) / 0;
  row.push(text());
  number[0] = Math.clz32(-(zero / zero)) / zero;
  row.push(text());
  number[0] = made109(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made109(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.clz32(-(0 / 0)) / 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.clz32(-(zero / zero)) / zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made109(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.clz32(-(0 / 0)) / 0".padEnd(28), row.join(" "));
}
function made110(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.abs(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.abs(-(0 / 0));
  row.push(text());
  number[0] = Math.abs(-(zero / zero));
  row.push(text());
  number[0] = made110(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made110(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.abs(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.abs(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made110(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.abs(-(0 / 0))".padEnd(28), row.join(" "));
}
function made111(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.fround(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.fround(-(0 / 0));
  row.push(text());
  number[0] = Math.fround(-(zero / zero));
  row.push(text());
  number[0] = made111(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made111(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.fround(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.fround(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made111(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.fround(-(0 / 0))".padEnd(28), row.join(" "));
}
function made112(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.f16round(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.f16round(-(0 / 0));
  row.push(text());
  number[0] = Math.f16round(-(zero / zero));
  row.push(text());
  number[0] = made112(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made112(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.f16round(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.f16round(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made112(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.f16round(-(0 / 0))".padEnd(28), row.join(" "));
}
function made113(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.floor(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.floor(-(0 / 0));
  row.push(text());
  number[0] = Math.floor(-(zero / zero));
  row.push(text());
  number[0] = made113(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made113(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.floor(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.floor(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made113(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.floor(-(0 / 0))".padEnd(28), row.join(" "));
}
function made114(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.ceil(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.ceil(-(0 / 0));
  row.push(text());
  number[0] = Math.ceil(-(zero / zero));
  row.push(text());
  number[0] = made114(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made114(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.ceil(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.ceil(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made114(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.ceil(-(0 / 0))".padEnd(28), row.join(" "));
}
function made115(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.round(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.round(-(0 / 0));
  row.push(text());
  number[0] = Math.round(-(zero / zero));
  row.push(text());
  number[0] = made115(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made115(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.round(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.round(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made115(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.round(-(0 / 0))".padEnd(28), row.join(" "));
}
function made116(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.trunc(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.trunc(-(0 / 0));
  row.push(text());
  number[0] = Math.trunc(-(zero / zero));
  row.push(text());
  number[0] = made116(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made116(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.trunc(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.trunc(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made116(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.trunc(-(0 / 0))".padEnd(28), row.join(" "));
}
function made117(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.sign(-(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.sign(-(0 / 0));
  row.push(text());
  number[0] = Math.sign(-(zero / zero));
  row.push(text());
  number[0] = made117(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made117(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.sign(-(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.sign(-(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made117(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.sign(-(0 / 0))".padEnd(28), row.join(" "));
}
function made118(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.min(-(zero / zero), one);
}
{
  const row: string[] = [];
  number[0] = Math.min(-(0 / 0), 1);
  row.push(text());
  number[0] = Math.min(-(zero / zero), one);
  row.push(text());
  number[0] = made118(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made118(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.min(-(0 / 0), 1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.min(-(zero / zero), one);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made118(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.min(-(0 / 0), 1)".padEnd(28), row.join(" "));
}
function made119(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.max(one, -(zero / zero));
}
{
  const row: string[] = [];
  number[0] = Math.max(1, -(0 / 0));
  row.push(text());
  number[0] = Math.max(one, -(zero / zero));
  row.push(text());
  number[0] = made119(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made119(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.max(1, -(0 / 0));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.max(one, -(zero / zero));
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made119(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.max(1, -(0 / 0))".padEnd(28), row.join(" "));
}
function made120(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return Math.hypot(-(zero / zero), one);
}
{
  const row: string[] = [];
  number[0] = Math.hypot(-(0 / 0), 1);
  row.push(text());
  number[0] = Math.hypot(-(zero / zero), one);
  row.push(text());
  number[0] = made120(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made120(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Math.hypot(-(0 / 0), 1);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = Math.hypot(-(zero / zero), one);
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made120(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Math.hypot(-(0 / 0), 1)".padEnd(28), row.join(" "));
}
function made121(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return zero / zero + one;
}
{
  const row: string[] = [];
  number[0] = 0 / 0 + 1;
  row.push(text());
  number[0] = zero / zero + one;
  row.push(text());
  number[0] = made121(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made121(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 0 / 0 + 1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = zero / zero + one;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made121(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(0 / 0) + 1".padEnd(28), row.join(" "));
}
function made122(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return one + zero / zero;
}
{
  const row: string[] = [];
  number[0] = 1 + 0 / 0;
  row.push(text());
  number[0] = one + zero / zero;
  row.push(text());
  number[0] = made122(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made122(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = 1 + 0 / 0;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = one + zero / zero;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made122(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("1 + 0 / 0".padEnd(28), row.join(" "));
}
function made123(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return (zero / zero) * two;
}
{
  const row: string[] = [];
  number[0] = (0 / 0) * 2;
  row.push(text());
  number[0] = (zero / zero) * two;
  row.push(text());
  number[0] = made123(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made123(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = (0 / 0) * 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = (zero / zero) * two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made123(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(0 / 0) * 2".padEnd(28), row.join(" "));
}
function made124(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -(zero / zero) * two;
}
{
  const row: string[] = [];
  number[0] = -(0 / 0) * 2;
  row.push(text());
  number[0] = -(zero / zero) * two;
  row.push(text());
  number[0] = made124(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made124(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -(0 / 0) * 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -(zero / zero) * two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made124(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-(0 / 0) * 2".padEnd(28), row.join(" "));
}
function made125(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return (endless - endless) / two;
}
{
  const row: string[] = [];
  number[0] = (Infinity - Infinity) / 2;
  row.push(text());
  number[0] = (endless - endless) / two;
  row.push(text());
  number[0] = made125(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made125(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = (Infinity - Infinity) / 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = (endless - endless) / two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made125(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("(Infinity - Infinity) / 2".padEnd(28), row.join(" "));
}
function made126(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return endless % less;
}
{
  const row: string[] = [];
  number[0] = Infinity % -1;
  row.push(text());
  number[0] = endless % less;
  row.push(text());
  number[0] = made126(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made126(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Infinity % -1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = endless % less;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made126(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Infinity % (-1)".padEnd(28), row.join(" "));
}
function made127(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -endless % less;
}
{
  const row: string[] = [];
  number[0] = -Infinity % -1;
  row.push(text());
  number[0] = -endless % less;
  row.push(text());
  number[0] = made127(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made127(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -Infinity % -1;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -endless % less;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made127(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-Infinity % (-1)".padEnd(28), row.join(" "));
}
function made128(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return endless % two;
}
{
  const row: string[] = [];
  number[0] = Infinity % 2;
  row.push(text());
  number[0] = endless % two;
  row.push(text());
  number[0] = made128(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made128(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Infinity % 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = endless % two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made128(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Infinity % 2".padEnd(28), row.join(" "));
}
function made129(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return -endless % two;
}
{
  const row: string[] = [];
  number[0] = -Infinity % 2;
  row.push(text());
  number[0] = -endless % two;
  row.push(text());
  number[0] = made129(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made129(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = -Infinity % 2;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = -endless % two;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made129(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("-Infinity % 2".padEnd(28), row.join(" "));
}
function made130(zero: number, endless: number, less: number, none: number, one: number, two: number) {
  return endless % endless;
}
{
  const row: string[] = [];
  number[0] = Infinity % Infinity;
  row.push(text());
  number[0] = endless % endless;
  row.push(text());
  number[0] = made130(0, Infinity, -1, NaN, 1, 2);
  row.push(text());
  number[0] = made130(values[0], values[1], values[2], values[3], values[4], values[5]);
  row.push(text());
  boxes[0] = Infinity % Infinity;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = endless % endless;
  number[0] = boxes[0] as number;
  row.push(text());
  boxes[0] = made130(values[0], values[1], values[2], values[3], values[4], values[5]);
  number[0] = boxes[0] as number;
  row.push(text());
  console.log("Infinity % Infinity".padEnd(28), row.join(" "));
}
