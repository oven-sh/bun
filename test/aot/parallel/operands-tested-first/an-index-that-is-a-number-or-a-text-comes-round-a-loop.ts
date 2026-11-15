const log: string[] = [];
function skip(source: string, i: number | string): number | string {
  let at = +i;
  while (source.charCodeAt(++at) !== 34 && at < source.length);
  return at % 3 ? at : String(at);
}
function scan(source: string, i: number | string): number {
  let sum = 0;
  for (; (i as number) < source.length; (i as number)++) {
    const unit = source.charCodeAt(i as number);
    if (unit === 34) {
      i = skip(source, i);
      continue;
    }
    sum += unit & 7;
  }
  return sum;
}
function characters(source: string, places: (number | string)[]): string {
  const out: string[] = [];
  for (let k = 0; k < places.length; k++) {
    const place = places[k]! as number;
    out.push(source.charAt(place) + "|" + source.charCodeAt(place) + "|" + source.codePointAt(place) + "|" + source.at(place) + "|" + source.slice(place, 5) + "|" + source.substring(1, place) + "|" + source.indexOf("c", place) + "|" + source.padStart(+place < 40 ? place : 0, "*").length + "|" + source.repeat(+place > 0 && +place < 3 ? place : 0).length);
  }
  return out.join(" ");
}
function order(source: string, turns: number): string {
  const out: string[] = [];
  for (let t = 0; t < turns; t++) {
    const first = { valueOf() { log.push("first" + t); return 1; } } as unknown as number;
    const second = (t & 1 ? "4" : 4) as number;
    out.push(source.slice(first, second));
    out.push(source.slice(second, { valueOf() { log.push("second" + t); return 6; } } as unknown as number));
  }
  return out.join();
}
const text: string = JSON.parse('"' + 'a \\"bc\\" d\\n'.repeat(12) + '"');
console.log(scan(text, 0), scan(text, "0"), scan(text, "3"), scan(text, 2.5), scan(text, "x"), scan(text, ""), scan(text, -1), scan(text, "1e1"));
console.log(characters("abcdef\u{1F600}", [0, "0", 1, "1", "2.9", 2.9, -1, "-1", "", " 3 ", "x", NaN, Infinity, "Infinity", 6, "6", 7, "0x2", 4294967296, "4294967297"]));
console.log(order("abcdefgh", 4), log.join());
