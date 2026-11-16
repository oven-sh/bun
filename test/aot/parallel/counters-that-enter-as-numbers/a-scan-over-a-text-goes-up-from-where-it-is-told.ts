// The scan returns the counter itself: -0 stays -0 only where no turn has stepped it.
const shown: string[] = [];
function show(value: unknown): void {
  shown.push(Object.is(value, -0) ? "-0" : String(value));
}
function scan(text: string, from: number): number {
  let turns = 0;
  for (let at = from; at < text.length; at++) {
    if (++turns > 40) return -2;
    if (text.charCodeAt(at) === 10) return at;
  }
  return -1;
}
const held = "abc\ndefgh\nij";
show(scan(held, 0));
show(scan(held, 1));
show(scan(held, 5));
show(scan(held, -0));
show(scan(held, -1));
show(scan(held, -5));
show(scan(held, 1.5));
show(scan(held, -1.5));
show(scan(held, 0.25));
show(scan(held, NaN));
show(scan(held, 2147483640));
show(scan(held, 2147483646));
show(scan(held, 2147483647));
show(scan(held, 2147483648));
show(scan(held, 4294967295));
show(scan(held, 4294967296));
show(scan(held, 9007199254740991));
show(scan(held, 9007199254740992));
show(scan(held, 1e300));
show(scan(held, Infinity));
show(scan(held, -Infinity));
show(scan(held, -2147483648));
show(scan(held, -2147483649));
show(scan(held, -2147483640));
console.log(shown.join(" "));
