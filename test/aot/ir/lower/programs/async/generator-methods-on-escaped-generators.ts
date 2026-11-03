// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: failing outer Tree
// CHECK-LABEL: function {{*}}name="failing"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_1]]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="TypeError" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="inside"
// CHECK-NEXT: v12 = Construct v10, -, v11 calleeName="TypeError"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|TypeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="outer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Generator<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Generator<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|null|Generator<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = IteratorOpen v2 [isDelegating]
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Jump -> next b2(v5)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: v7 = IteratorResume v4, v6 [readsValueWhenDone]
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b5(v9), notTaken b3(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v12 = Convert v10 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = Yield v12, v2
// CHECK-NEXT: v14 = ResultAt v13
// CHECK-NEXT: v15 = ResultAt v13 index=1
// CHECK-NEXT: Switch v15 cases=[1, 2] -> case b4(v14), case b6(v14), otherwise b2(v14)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: v17 = IteratorResume v4, v16 resumeMode=Throw [readsValueWhenDone]
// CHECK-NEXT: v18 = ResultAt v17
// CHECK-NEXT: v19 = ResultAt v17 index=1
// CHECK-NEXT: Branch v18 -> taken b5(v19), notTaken b3(v19)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v22 = String string="outer got "
// CHECK-NEXT: v23 = ToString v21
// CHECK-NEXT: v24 = Strcat v22, v23
// CHECK-NEXT: Return v24
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = IteratorResume v4, v25 resumeMode=Return [readsValueWhenDone]
// CHECK-NEXT: v27 = ResultAt v26
// CHECK-NEXT: v28 = ResultAt v26 index=1
// CHECK-NEXT: Branch v27 -> taken b7(v28), notTaken b3(v28)
// CHECK-NEXT: b7(v29):
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Tree"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_4]]}, {type=undefined|null|Array<undefined|null|[[L_5]]> site=[[w_6]] flags=[OmitsNull]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|Array<undefined|null|[[L_5]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_7]]
// CHECK-NEXT: v7 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Data data=[[d_8]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|[[L_5]]> site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Jump -> next b5(v11)
// CHECK-NEXT: b5(v12):
// CHECK-NEXT: v13 = Convert v1 declared={type=number site=[[w_9]]}
// CHECK-NEXT: PropSet v5, v13 key="value"
// CHECK-NEXT: v15 = Convert v12 declared={type=undefined|null|Array<undefined|null|[[L_5]]> site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v5, v15 key="children"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v18 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: Jump -> next b8(v19)
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Jump -> next b8(v5)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
