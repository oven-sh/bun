// With --minify a plain build renames `#name` as it does any identifier, and so does --aot. A string that spells the same text is a string and stays.
declare const console: { log(...args: unknown[]): void }
class Counter {
  #countKeptPrivate = 0
  static #madeKeptPrivate = 0
  #stepKeptPrivate(): number { return ++this.#countKeptPrivate }
  get #doubleKeptPrivate(): number { return this.#countKeptPrivate * 2 }
  bump(): number { Counter.#madeKeptPrivate++; return this.#stepKeptPrivate() + this.#doubleKeptPrivate }
  static has(o: object): boolean { return #countKeptPrivate in o }
  static made(): number { return Counter.#madeKeptPrivate }
  lengthOfName(): boolean { return this.#stepKeptPrivate.name.length < 5 && this.#stepKeptPrivate.name.startsWith("#") }
}
class Tagged extends Map<string, number> {
  #tagKeptPrivate = "tag"
  #readKeptPrivate(): string { return this.#tagKeptPrivate + this.size }
  read(): string { return this.#readKeptPrivate() }
  static has(o: object): boolean { return #tagKeptPrivate in o }
}
class Other { #countKeptPrivate = "another class, the same spelling"; read(): string { return this.#countKeptPrivate } static has(o: object): boolean { return #countKeptPrivate in o } }
function early(n: number) {
  return class Early {
    static readAhead(): string { try { return String(Early.#lateKeptPrivate) } catch (e) { return (e as Error).constructor.name } }
    static hasAhead(): boolean { return #lateKeptPrivate in Early }
    static ahead: string = Early.readAhead() + " " + Early.hasAhead()
    static #lateKeptPrivate = n
    static behind: string = Early.readAhead() + " " + Early.hasAhead()
  }
}
console.log(early(4).ahead, early(5).behind)
const counter = new Counter()
console.log(counter.bump(), counter.bump(), Counter.made(), Counter.has(counter), Counter.has({}), Counter.has(new Other()), Other.has(counter), Other.has(new Other()), counter.lengthOfName())
const tagged = new Tagged([["a", 1]])
console.log(tagged.read(), Tagged.has(tagged), Tagged.has(new Map()), new Other().read())
function nameOfError(run: () => unknown): string { try { run() } catch (e) { return (e as Error).constructor.name } return "nothing" }
console.log(nameOfError(() => Counter.prototype.bump.call({} as Counter)), nameOfError(() => Tagged.prototype.read.call(new Map() as Tagged)))
console.log("#countKeptPrivate".length, ["#stepKeptPrivate", "#tagKeptPrivate"].join(), Object.keys(counter).length, JSON.stringify(counter), Reflect.ownKeys(tagged).length)
