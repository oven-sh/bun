// A class inside a function that runs once: its private methods and accessors capture the function's locals.
function main(): void {
  const n = Date.now()
  let stored = 0
  class C {
    #m(): number { return n }
    get #g(): number { return n }
    set #g(v: number) { stored = v }
    static #s(): number { return n }
    run(): boolean[] {
      this.#g = 5
      return [this.#m() === n, this.#g === n, stored === 5, C.#s() === n]
    }
  }
  console.log(new C().run().join())
}
main()
export {}
