const at = (holder: any, place: number) => holder.charCodeAt(place);
function next(holder: any, place: number): any {
  return at(holder, place) + 1;
}
class Longer extends String {
  charCodeAt(place: number): number { return super.charCodeAt(place) * 2; }
}
console.log(next("abc", 1));
console.log(next({ charCodeAt: (place: number) => place + 7 }, 1));
console.log(next(new String("abc"), 2));
console.log(next(new Longer("abc"), 0));
console.log(next(new Proxy({ charCodeAt: () => 3 }, {}), 0));
console.log(next(new Proxy({}, { get: (_, name) => () => String(name).length }), 0));
for (const holder of [null, undefined, 5, {}, { charCodeAt: 4 }, Symbol("s")]) {
  try { console.log(next(holder, 0)); } catch (error) { console.log((error as Error).constructor.name); }
}
