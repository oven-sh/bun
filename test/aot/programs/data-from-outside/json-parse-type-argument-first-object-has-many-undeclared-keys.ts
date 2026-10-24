// The first object of a type, before anything is learned about it, has 1 to 1,100 undeclared keys; the second as many, fewer or more.
const host: any = globalThis;
const collect: () => void = host.Bun ? () => host.Bun.gc(true) : host.gc;
let serial = 0;
function longText(): string {
  return '"text number ' + ++serial + ' is too long for a cache of short strings"';
}
function freshValue(at: number): string {
  switch (at % 4) {
    case 0:
      return longText();
    case 1:
      return '{"a":' + longText() + ',"b":[' + longText() + "]}";
    case 2:
      return "[" + longText() + "," + ++serial + "]";
    default:
      return longText();
  }
}

type F0 = { first0: number; second0: string };
type F1 = { first1: number; second1: string };
type F2 = { first2: number; second2: string };
type F3 = { first3: number; second3: string };
type F4 = { first4: number; second4: string };
type F5 = { first5: number; second5: string };
type F6 = { first6: number; second6: string };
type F7 = { first7: number; second7: string };
type F8 = { first8: number; second8: string };
type F9 = { first9: number; second9: string };
type F10 = { first10: number; second10: string };
type F11 = { first11: number; second11: string };
type F12 = { first12: number; second12: string };
type F13 = { first13: number; second13: string };
type F14 = { first14: number; second14: string };
type F15 = { first15: number; second15: string };
type F16 = { first16: number; second16: string };
type F17 = { first17: number; second17: string };
type F18 = { first18: number; second18: string };
type F19 = { first19: number; second19: string };
type F20 = { first20: number; second20: string };
function textOf(type: number, count: number, place: number): string {
  const others: string[] = [];
  for (let at = 0; at < count; at++) others.push('"o' + at + '":' + freshValue(at));
  const declared = ['"first' + type + '":' + count, '"second' + type + '":' + longText()];
  return "{" + (place === 0 ? [...declared, ...others] : place === 1 ? [...others, ...declared] : [declared[0], ...others, declared[1]]).join(",") + "}";
}
function check(label: string, parse: (text: string) => unknown, type: number, count: number): void {
  let different = 0;
  const kept: [unknown, string][] = [];
  for (const next of [count, count, 1, count + 1, count * 2, 0, count]) {
    for (let place = 0; place < 3; place++) {
      const text = textOf(type, next, place);
      const value = parse(text);
      if (JSON.stringify(value) !== text) different++;
      kept.push([value, text]);
    }
  }
  for (const [value, text] of kept) if (JSON.stringify(value) !== text) different++;
  console.log(label + ": " + different + " differ");
}
check("the first has 1", text => JSON.parse<F0>(text), 0, 1);
check("the first has 2", text => JSON.parse<F1>(text), 1, 2);
check("the first has 3", text => JSON.parse<F2>(text), 2, 3);
check("the first has 4", text => JSON.parse<F3>(text), 3, 4);
check("the first has 5", text => JSON.parse<F4>(text), 4, 5);
check("the first has 6", text => JSON.parse<F5>(text), 5, 6);
check("the first has 7", text => JSON.parse<F6>(text), 6, 7);
check("the first has 8", text => JSON.parse<F7>(text), 7, 8);
check("the first has 9", text => JSON.parse<F8>(text), 8, 9);
check("the first has 16", text => JSON.parse<F9>(text), 9, 16);
check("the first has 17", text => JSON.parse<F10>(text), 10, 17);
check("the first has 32", text => JSON.parse<F11>(text), 11, 32);
check("the first has 33", text => JSON.parse<F12>(text), 12, 33);
check("the first has 63", text => JSON.parse<F13>(text), 13, 63);
check("the first has 64", text => JSON.parse<F14>(text), 14, 64);
check("the first has 65", text => JSON.parse<F15>(text), 15, 65);
check("the first has 100", text => JSON.parse<F16>(text), 16, 100);
check("the first has 200", text => JSON.parse<F17>(text), 17, 200);
check("the first has 300", text => JSON.parse<F18>(text), 18, 300);
check("the first has 1000", text => JSON.parse<F19>(text), 19, 1000);
check("the first has 1100", text => JSON.parse<F20>(text), 20, 1100);
