// A private field on an instance of a class below Map: no compiled object. What a closed read of it answers is typed by what Link has proven of the field: every kind that is stored must be in that proof.
class Holder extends Map<string, number> { #v: any = 0; put(v: any) { this.#v = v; } take() { return this.#v; } twice() { return this.#v + this.#v; } }
const holder = new Holder(); let out = "";
for (const value of [1, 2.5, "text", null, undefined, { a: 1 }, 10n, true, Symbol.iterator, -0, NaN, 2 ** 40]) { for (let turn = 0; turn < 300; turn++) holder.put(value); let twice: any; try { twice = String(holder.twice()); } catch (error: any) { twice = error.constructor.name; } out += typeof holder.take() + ":" + twice + " "; }
console.log(out);
