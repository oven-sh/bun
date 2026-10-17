// A generator function made inside another function has a `prototype` of its own, and its generators inherit from it. The runtime remembers, by
// closure, the Structure those generators get. However many such closures a program calls in turn, each is looked up once.
// Only the jsc shell with --useAOTOperationCounters=1 can count. Elsewhere the program checks the answers alone.
declare const aotOperationCount: undefined | ((name: string) => number)
const count = typeof aotOperationCount === 'function' ? aotOperationCount : () => 0

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
const before = count('State::generatorStructure')
for (let turn = 0; turn < 200; turn++) {
  for (const steps of all) sum += run(steps, turn)
}
const missed = count('State::generatorStructure') - before
console.log(sum, missed < 500 ? 'each closure was looked up once' : 'looked up anew ' + missed + ' times')

const one = all[3], other = all[19]
console.log(Object.getPrototypeOf(one(0)) === one.prototype, Object.getPrototypeOf(other(0)) === other.prototype, one.prototype === other.prototype)
console.log(run(one, 5), run(other, 5))

let fresh = 0
for (let i = 0; i < 1000; i++) fresh += run(make(i), i)
console.log(fresh, run(other, 7), Object.getPrototypeOf(other(0)) === other.prototype)
