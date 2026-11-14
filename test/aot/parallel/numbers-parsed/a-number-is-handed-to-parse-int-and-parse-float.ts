function say(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}
const odd: number[] = [0, -0, 1, -1, 0.5, -0.5, 0.999999, -0.999999, 1.5, -1.5, 0.000001, 0.0000009, -0.000001, -0.0000009, 1e-7, -1e-7, 5e-324, 123456.789, -123456.789,
  9007199254740991, 9007199254740992, 9007199254740994, -9007199254740991, -9007199254740992, 1e20, 1.5e20, 1e21, 1.5e21, -1e21, 7.25e22, 1.7976931348623157e308, NaN, Infinity, -Infinity, 2147483647.5, -2147483648.5, 4294967296.25];
function fractions(list: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const x = +list[i]!;
    out.push(say(parseInt(x as any)) + "," + say(parseInt(x as any, 10)) + "," + say(parseInt(x as any, 0)) + "," + say(parseInt(x as any, undefined)) + "," + say(Number.parseInt(x as any)) + "," + say(parseFloat(x as any)) + "," + say(Number.parseFloat(x as any)));
  }
  return out.join(" ");
}
function otherRadixes(list: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const x = +list[i]!;
    out.push(say(parseInt(x as any, 16)) + "," + say(parseInt(x as any, 2)) + "," + say(parseInt(x as any, 36)) + "," + say(parseInt(x as any, 37)) + "," + say(parseInt(x as any, 1)) + "," + say(parseInt(x as any, "10" as any)) + "," + say(parseInt(x as any, 10.9)) + "," + say(parseInt(x as any, 4294967306)));
  }
  return out.join(" ");
}
function integers(count: number): number {
  let sum = 0;
  for (let i = -count; i < count; i++) sum += parseInt((i * 7) as any) + parseInt((i | 0) as any, 10) + parseFloat((i * 3) as any) + parseInt((i * 1000003 * 1000003) as any);
  return sum;
}
function written(): string {
  return [parseInt(3.7 as any), parseInt(-0.5 as any), parseInt(1e21 as any), parseInt(1e-7 as any), parseInt(-0 as any), parseFloat(-0 as any), parseFloat(2.5 as any), parseInt(NaN as any), parseInt(12 as any, 16)].map(say).join();
}
console.log(fractions(odd));
console.log(otherRadixes(odd.slice(0, 24)));
console.log(integers(500), written());
