// Array[Symbol.species] is defined anew in the midst of the run. Plain Bun takes it, and from then on map gives what the new species makes. A compiled program locks the built-in: the definition throws, and map goes on giving lists.
function Made(this: any, length: number) { this.madeWith = length; this.length = 0; }
function doubled(list: number[]): any { return list.map(x => x * 2); }
function tell(out: any): string { let sum = 0; for (let i = 0; i < out.length; i++) sum += out[i]; return [sum, out.length, Array.isArray(out), out.madeWith].join(); }
const said: string[] = [];
for (let turn = 0; turn < 40; turn++) {
  if (turn === 30) { try { Object.defineProperty(Array, Symbol.species, { value: Made, configurable: true }); said.push("defined"); } catch (error) { said.push((error as Error).constructor.name); } }
  if (turn > 27) said.push(tell(doubled([1, 2, turn])));
}
console.log(said.join("|")); export {};
/* Output:
62,3,true,|64,3,true,|TypeError|66,3,true,|68,3,true,|70,3,true,|72,3,true,|74,3,true,|76,3,true,|78,3,true,|80,3,true,|82,3,true,|84,3,true,
*/
