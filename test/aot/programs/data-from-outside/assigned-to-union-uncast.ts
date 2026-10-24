// A value of a type that comes from JSON is assigned to a union of object types without a cast: as an argument, a result, a store and an element.
declare const console: { log(...values: unknown[]): void };
type Named = { name: string };
type Shape = { name: string; size?: number } | { side: number };
function text(s: Shape): string {
  if ('side' in s) {
    return 'side ' + s.side;
  }
  return 'name ' + s.name + ' ' + s.size + ' ' + Object.keys(s).join();
}
function same(s: Shape, o: unknown): boolean {
  return s === o;
}
function pass(n: Named): Shape {
  return n;
}
const parsed = JSON.parse('{"name":"n","more":1}') as Named;
console.log(text(parsed), same(parsed, parsed));
console.log(text(pass(parsed)), pass(parsed) === parsed);
const list: Shape[] = [{ side: 2 }];
list.push(parsed);
console.log(list.map(text).join('; '), list[1] === parsed);
const holder: { shape: Shape } = { shape: { side: 3 } };
holder.shape = parsed;
console.log(text(holder.shape), holder.shape === parsed);
console.log(text({ name: 'own', size: 4 }), text({ side: 5 }));
