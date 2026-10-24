// A generic function returns a variable of type `any`. It holds a function with two more members, which no layout can be given to.
// The call types the result as a mapped type over its argument, and the program makes an object with the same members elsewhere.
interface Counter {
  readonly count: () => number
  readonly label: string
}
function callable<Shape>(parts: Shape): { [K in keyof Shape]: Shape[K] } {
  const made: any = Object.assign(function () {}, parts)
  return made
}
const plain: Counter = { count: () => 1, label: 'plain' }
const built = callable({ count: () => 2, label: 'built' })
const counters: Counter[] = [plain, built]
console.log(counters.map(counter => counter.label + counter.count()).join(), typeof built)
