// next(), return() and throw() on generators whose creation the caller cannot see.
const shelf: unknown[] = []
function hide<T>(value: T): T {
  shelf.push(value)
  return shelf[shelf.length - 1] as T
}
function show(label: string, action: () => unknown) {
  try {
    console.log(label, JSON.stringify(action()))
  } catch (error) {
    console.log(label, 'threw', error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  }
}

function* count(from: number, to: number): Generator<number, string, number | undefined> {
  let total = 0
  for (let n = from; n < to; n++) total += (yield n) ?? 0
  return `sent ${total}`
}

const counted = hide(count(1, 4))
show('first', () => counted.next(100))
show('second', () => counted.next(10))
show('third', () => counted.next(20))
show('last', () => counted.next(30))
show('after the end', () => counted.next(40))
show('return after the end', () => counted.return('late'))
show('throw after the end', () => counted.throw(new RangeError('late')))

const shaped = hide(count(0, 2))
const one = shaped.next()
const two = shaped.next()
console.log(one === two, Object.keys(one).join(), Object.getPrototypeOf(one) === Object.prototype, JSON.stringify(Object.getOwnPropertyDescriptors(one)))
console.log(shaped[Symbol.iterator]() === shaped, Object.prototype.toString.call(shaped), typeof shaped.next, shaped.next.name, shaped.next.length, shaped.return.name, shaped.throw.name)
console.log(shaped.next === hide(count(0, 1)).next, Object.hasOwn(shaped, 'next'), String(shaped.next).includes('[native code]'))

function* failing(): Generator<number, void, void> {
  yield 1
  throw new TypeError('inside')
}
const failed = hide(failing())
show('before the failure', () => failed.next())
show('the failure', () => failed.next())
show('after the failure', () => failed.next())
show('return after the failure', () => failed.return())

let reentrant: Generator<string, string, void>
function* entersItself(): Generator<string, string, void> {
  let message = ''
  try {
    reentrant.next()
  } catch (error) {
    message = `${(error as Error).name}: ${(error as Error).message}`
  }
  yield message
  try {
    reentrant.return('x')
  } catch (error) {
    message = `${(error as Error).name}`
  }
  yield message
  try {
    reentrant.throw(1)
  } catch (error) {
    message = `${(error as Error).name}`
  }
  return message
}
reentrant = hide(entersItself())
show('enters itself by next', () => reentrant.next())
show('enters itself by return', () => reentrant.next())
show('enters itself by throw', () => reentrant.next())
show('and is done', () => reentrant.next())

const log: string[] = []
function* guarded(kind: string): Generator<string, string, string | undefined> {
  try {
    log.push('try')
    const sent = yield 'in try'
    log.push(`sent ${sent}`)
    return 'end of try'
  } catch (error) {
    log.push(`caught ${error}`)
    if (kind === 'rethrows') throw `again ${error}`
    yield 'in catch'
    return 'end of catch'
  } finally {
    log.push('finally')
    if (kind === 'yields in finally') yield 'in finally'
    if (kind === 'throws in finally') throw new Error('from finally')
    if (kind === 'returns in finally') return 'from finally'
  }
}
for (const kind of ['plain', 'yields in finally', 'throws in finally', 'returns in finally', 'rethrows']) {
  for (const method of ['return', 'throw'] as const) {
    const early = hide(guarded(kind))
    show(`${kind}: ${method} before the start`, () => early[method]('early'))
    show(`${kind}: next after that`, () => early.next())
    const started = hide(guarded(kind))
    started.next()
    show(`${kind}: ${method} at the yield`, () => started[method]('now'))
    show(`${kind}: next after that`, () => started.next('more'))
    show(`${kind}: and again`, () => started.next('more'))
  }
}
console.log(log.join(' | '))

const { next, return: finish, throw: raise } = Object.getPrototypeOf(Object.getPrototypeOf(hide(count(0, 1)))) as Generator<number, string, number>
const borrowed = hide(count(5, 7))
show('a borrowed next', () => next.call(borrowed, 1))
show('a borrowed next by apply', () => Reflect.apply(next, borrowed, []))
show('a borrowed return', () => finish.call(borrowed, 'stop'))
for (const receiver of [undefined, null, 1, 'text', {}, [], () => 1, Object.create(borrowed), (async function* () {})(), [][Symbol.iterator]()]) {
  show(`next on ${Object.prototype.toString.call(receiver)}`, () => next.call(receiver as any))
  show(`return on ${Object.prototype.toString.call(receiver)}`, () => finish.call(receiver as any, 'x'))
  show(`throw on ${Object.prototype.toString.call(receiver)}`, () => raise.call(receiver as any, 'x'))
}

class Tree {
  readonly value: number
  readonly children: Tree[]
  constructor(value: number, children: Tree[] = []) {
    this.value = value
    this.children = children
  }
  *walk(): Generator<number, number, void> {
    let seen = 1
    yield this.value
    for (const child of this.children) seen += yield* hide(child.walk())
    return seen
  }
}
const tree = new Tree(1, [new Tree(2, [new Tree(3), new Tree(4)]), new Tree(5)])
const walk = hide(tree.walk())
const visited: number[] = []
for (let step = walk.next(); ; step = walk.next()) {
  if (step.done) {
    console.log(visited.join(), step.value)
    break
  }
  visited.push(step.value)
}
console.log([...hide(tree.walk())].join(), Array.from(hide(tree.walk()), (n) => n * 2).join(), Math.max(...hide(tree.walk())))
const [head, , third, ...others] = hide(tree.walk())
console.log(head, third, others.join())

function* outer(inner: Generator<string, string, string | undefined>): Generator<string, string, string | undefined> {
  const result = yield* inner
  return `outer got ${result}`
}
for (const method of ['next', 'return', 'throw'] as const) {
  const delegating = hide(outer(hide(guarded('yields in finally'))))
  show(`delegating: start`, () => delegating.next())
  show(`delegating: ${method}`, () => delegating[method]('through'))
  show(`delegating: next`, () => delegating.next('after'))
  show(`delegating: next`, () => delegating.next('after'))
}

function* nested(depth: number): Generator<number, number, void> {
  if (depth === 0) return 0
  const inner = hide(nested(depth - 1))
  let step = inner.next()
  while (!step.done) {
    yield step.value
    step = inner.next()
  }
  yield depth
  return step.value + 1
}
shelf.length = 0
let sum = 0
const deep = hide(nested(200))
for (let step = deep.next(); ; step = deep.next()) {
  if (step.done) {
    console.log(sum, step.value)
    break
  }
  sum += step.value
}

function* allocating(rounds: number): Generator<{ id: number; text: string }, number, { id: number } | undefined> {
  let kept = 0
  for (let id = 0; id < rounds; id++) {
    const sent = yield { id, text: `record ${id}` }
    kept += sent ? sent.id : 0
  }
  return kept
}
shelf.length = 0
const records = hide(allocating(20000))
let checksum = 0
for (let step = records.next(); !step.done; step = records.next({ id: step.value.id })) checksum += step.value.text.length + step.value.id
console.log(checksum, JSON.stringify(records.next()))

const tagged = hide(count(0, 3)) as Generator<number, string, number | undefined> & { tag?: string }
tagged.tag = 'mine'
show('with an own property', () => [tagged.next(), tagged.tag, Object.keys(tagged)])
const shadowed = hide(count(0, 3)) as Generator<number, string, number | undefined>
Object.defineProperty(shadowed, 'next', { value: () => ({ value: -1, done: false }) })
show('with an own next', () => [shadowed.next(), next.call(shadowed, 0)])
let turns = 0
for (const value of shadowed) {
  if (++turns > 2) break
  console.log('for of sees', value)
}
