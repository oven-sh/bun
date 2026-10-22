// A generator function made inside another function has a `prototype` of its own, and its generators inherit from it. The runtime remembers, by
// closure, the Structure those generators get: here a program calls more such closures in turn than it remembers at once.

type Steps = (from: number) => Generator<number, number, number>
function make(step: number): Steps {
  return function* (from: number) {
    const seen = yield from + step
    return seen + step
  }
}
function run(steps: Steps, from: number): number {
  const generator = steps(from)
  const first = generator.next()
  return generator.next(first.value).value
}

const all: Array<Steps> = []
for (let i = 0; i < 48; i++) all.push(make(i))
let sum = 0
for (const steps of all) sum += run(steps, 1)
for (let turn = 0; turn < 200; turn++) {
  for (const steps of all) sum += run(steps, turn)
}
console.log(sum)

const one = all[3], other = all[19]
console.log(Object.getPrototypeOf(one(0)) === one.prototype, Object.getPrototypeOf(other(0)) === other.prototype, one.prototype === other.prototype)
console.log(run(one, 5), run(other, 5))

let fresh = 0
for (let i = 0; i < 1000; i++) fresh += run(make(i), i)
console.log(fresh, run(other, 7), Object.getPrototypeOf(other(0)) === other.prototype)
