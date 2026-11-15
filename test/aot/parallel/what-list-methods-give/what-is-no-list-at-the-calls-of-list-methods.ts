// The methods of lists called on a proxy of a list, on an object with a length, on a text and on arguments, beside plain lists at the same calls.
function doubled(list: any): any { return Array.prototype.map.call(list, (x: any) => x + x); }
function kept(list: any): any { return Array.prototype.filter.call(list, () => true); }
function byName(list: any): any { return list.map((x: any) => x + x); }
function tell(out: any): string { return [out.length, Array.isArray(out), out.join("-"), Object.getPrototypeOf(out) === Array.prototype].join(); }
function rest(): any { return doubled(arguments); }
function walked(list: number[]): string { let sum = 0, turns = 0; try { for (const x of list.map((x: number) => x * 2)) { sum += x; turns++; } for (const x of list.filter((x: number) => x > 1)) { sum += x; turns++; } return sum + "/" + turns + "/" + [...list.map((x: number) => x + 1)].length; } catch (error) { return (error as Error).constructor.name + "/" + sum + "/" + turns; } }
const seen: string[] = [];
const said: string[] = [];
for (let turn = 0; turn < 40; turn++) {
  said.length = 0; seen.length = 0;
  const proxy = new Proxy([1, 2, 3], { get(target, key, receiver) { if (typeof key === "string") seen.push(key); return Reflect.get(target, key, receiver); } });
  for (const list of [[1, 2, 3], proxy, { length: 2, 0: "a", 1: "b" }, "xyz", [4]]) said.push(tell(doubled(list)), tell(kept(list)));
  said.push(tell(byName([1, 2])), tell(byName(proxy)), tell((rest as any)(1, 2, 3)), seen.join("."));
  said.push(walked([1, 2, 3]), walked(proxy), walked({ map() { return 5; }, filter() { return [1]; } } as any), walked({ map() { return "ab"; }, filter() { return new Set([7]); } } as any));
  said.push(tell(byName({ map(f: (x: number) => number) { return [f(21)]; } })));
}
console.log(said.join("|")); export {};
