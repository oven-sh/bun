// A property `constructor` laid on one list names a species of its own: what map, filter and flatMap give is what that species makes, and no list.
function Made(this: any, length: number) { this.madeWith = length; this.length = 0; }
function doubled(list: number[]): any { return list.map(x => x * 2); }
function odd(list: number[]): any { return list.filter(x => x % 2 === 1); }
function twice(list: number[]): any { return list.flatMap(x => [x, x]); }
function tell(out: any): string { let sum = 0; for (let i = 0; i < out.length; i++) sum += out[i]; return [sum, out.length, Array.isArray(out), out.madeWith, Object.keys(out).join("."), typeof out.map].join(); }
function walked(list: number[]): string { let sum = 0, turns = 0; try { for (const x of list.map((x: number) => x * 2)) { sum += x; turns++; } for (const x of list.filter((x: number) => x > 1)) { sum += x; turns++; } return sum + "/" + turns + "/" + [...list.map((x: number) => x + 1)].length; } catch (error) { return (error as Error).constructor.name + "/" + sum + "/" + turns; } }
const said: string[] = [];
for (let turn = 0; turn < 40; turn++) {
  said.length = 0;
  const plain = [1, 2, 3, turn], odder: any = [1, 2, 3, turn];
  if (turn > 20) odder.constructor = { [Symbol.species]: Made };
  for (const list of [plain, odder, plain]) said.push(tell(doubled(list)), tell(odd(list)), tell(twice(list)));
  said.push(walked(plain), walked(odder), walked(plain));
  const own: number[] = [1, 2, 3, turn]; (own as any).constructor = { [Symbol.species]: Made };
  let seen = 0; try { for (const x of own.map(x => x * 2)) seen += x; } catch (error) { seen = -1; }
  let kept = 0; try { for (const x of own.filter(x => x > 1)) kept += x; } catch (error) { kept = -1; }
  said.push(String(seen), String(kept), String((own.map(x => x) as any).madeWith), String((own.map(x => x) as any).length));
  let called = 0; try { for (const x of Array.prototype.map.call(own, (x: number) => x * 2) as number[]) called += x; } catch (error) { called = -1; }
  let sieved = 0; try { for (const x of Array.prototype.filter.call(own, () => true) as number[]) sieved += x; } catch (error) { sieved = -1; }
  said.push(String(called), String(sieved));
  const none: any = [5, 6]; none.constructor = undefined; said.push(tell(doubled(none)));
  const nothing: any = [7, 8]; nothing.constructor = { [Symbol.species]: null }; said.push(tell(doubled(nothing)));
  const wrong: any = [9]; wrong.constructor = 3; try { said.push(tell(doubled(wrong))); } catch (error) { said.push((error as Error).constructor.name); }
}
console.log(said.join("|")); export {};
