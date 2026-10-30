// RUN: lower
// OPTIONS: builtin-modules

// A client application on parsed data: an RPC layer that settles promises from a pending map, an API that callers only know by its interface, a directory, a generic cache, an event bus and an async generator. Every value comes from JSON.parse and matches its declared type. The program must behave as in plain Bun.
interface Address { city: string; zip?: string }
interface User { id: number; name: string; tags: string[]; address?: Address; role: 'admin' | 'user' }
interface Config { flags: Record<string, boolean>; limits: { max: number; min?: number }; owner: User | null }
type Result<T> = { ok: true; value: T } | { ok: false; error: string }
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

class Rpc {
  private pending = new Map<number, Pending>()
  private next = 1
  constructor(private answer: (method: string, params: unknown) => string) {}
  request<R>(method: string, params?: unknown): Promise<R> {
    const id = this.next++
    const text = JSON.stringify({ id, result: JSON.parse(this.answer(method, params)) })
    Promise.resolve().then(() => this.handle(text))
    return new Promise<R>((resolve, reject) => { this.pending.set(id, { resolve: value => resolve(value as R), reject }) })
  }
  private handle(text: string): void {
    const message = JSON.parse(text)
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    entry.resolve(message.result)
  }
}

interface Api {
  getUser(id: number): Promise<User>
  listUsers(): Promise<User[]>
  getConfig(): Promise<Config | null>
  tryUser(id: number): Promise<Result<User>>
}

class RpcApi implements Api {
  constructor(private rpc: Rpc) {}
  getUser(id: number): Promise<User> { return this.rpc.request('getUser', { id }) }
  listUsers(): Promise<User[]> { return this.rpc.request<User[]>('listUsers') }
  async getConfig(): Promise<Config | null> { return await this.rpc.request<Config | null>('getConfig') }
  tryUser(id: number): Promise<Result<User>> { return this.rpc.request('tryUser', { id }) }
}

const users = [
  { id: 1, name: 'Ada', tags: ['a', 'b'], address: { city: 'London' }, role: 'admin' },
  { id: 2, name: 'Bob', tags: [], role: 'user' },
  { id: 3, name: 'Cy', tags: ['c'], address: { city: 'Paris', zip: '75' }, role: 'user', extra: true },
]
function server(method: string, params: any): string {
  switch (method) {
    case 'getUser': return JSON.stringify(users.find(user => user.id === params.id))
    case 'listUsers': return JSON.stringify(users)
    case 'getConfig': return JSON.stringify({ flags: { fast: true, safe: false }, limits: { max: 10 }, owner: users[0] })
    case 'tryUser': { const found = users.find(user => user.id === params.id); return JSON.stringify(found ? { ok: true, value: found } : { ok: false, error: 'no user ' + params.id }) }
  }
  return 'null'
}

const guest: User = { id: 0, name: 'guest', tags: [], role: 'user' }
function describe(user: User): string { return `${user.id}:${user.name}:${user.role}:${user.tags.join('+')}:${user.address?.city ?? '-'}:${user.address?.zip ?? '-'}` }
function withDefaults(user: User): User & { active: boolean } { return { ...user, active: true } }
function isAdmin(user: { role: string }): boolean { return user.role === 'admin' }
function cityOf({ address }: User): string | undefined { return address?.city }
class Directory {
  private byId = new Map<number, User>()
  private all: User[] = []
  add(user: User): void { this.byId.set(user.id, user); this.all.push(user) }
  get(id: number): User | undefined { return this.byId.get(id) }
  names(): string[] { return this.all.map(user => user.name).sort() }
  admins(): User[] { return this.all.filter(isAdmin) }
}
class Cache<T> {
  private held = new Map<string, T>()
  hydrate(text: string): void { for (const [key, value] of Object.entries(JSON.parse(text))) this.held.set(key, value as T) }
  get(key: string): T | undefined { return this.held.get(key) }
  set(key: string, value: T): void { this.held.set(key, value) }
}
type Events = { joined: { user: User }; left: { id: number; reason?: string } }
class Bus {
  private handlers: { [E in keyof Events]?: ((payload: Events[E]) => void)[] } = {}
  on<E extends keyof Events>(event: E, handler: (payload: Events[E]) => void): void { (this.handlers[event] ??= [] as any).push(handler) }
  emit(event: keyof Events, text: string): void { for (const handler of (this.handlers[event] ?? []) as ((payload: any) => void)[]) handler(JSON.parse(text)) }
}
async function* stream<R>(lines: string[]): AsyncGenerator<R> { for (const line of lines) yield JSON.parse(line) as R }

async function main(api: Api): Promise<void> {
  const directory = new Directory()
  directory.add(guest)
  const ada = await api.getUser(1)
  console.log(describe(ada), isAdmin(ada), cityOf(ada))
  directory.add(ada)
  const all = await api.listUsers()
  for (const user of all) directory.add(user)
  console.log(directory.names().join(','), directory.admins().map(describe).join('|'))
  console.log(JSON.stringify(withDefaults(all[2]!)), describe(withDefaults(guest)))
  const [bob, config] = await Promise.all([api.getUser(2), api.getConfig()])
  console.log(describe(bob), config ? Object.entries(config.flags).map(([k, v]) => k + '=' + v).join(',') : 'none', config?.limits.max, config?.limits.min, config?.owner ? describe(config.owner) : 'nobody')
  for (const id of [3, 9]) {
    const result = await api.tryUser(id)
    console.log(result.ok ? describe(result.value) : 'error ' + result.error)
  }
  const cache = new Cache<User>()
  cache.hydrate(JSON.stringify({ x: users[1], y: users[2] }))
  cache.set('g', guest)
  console.log(['x', 'y', 'g', 'z'].map(key => { const user = cache.get(key); return user ? describe(user) : 'miss' }).join(' '))
  const bus = new Bus()
  const seen: string[] = []
  bus.on('joined', ({ user }) => { seen.push('joined ' + describe(user)); directory.add(user) })
  bus.on('left', payload => { seen.push('left ' + payload.id + ' ' + (payload.reason ?? 'no reason')) })
  bus.emit('joined', JSON.stringify({ user: users[2] }))
  bus.emit('left', '{"id": 2}')
  console.log(seen.join('; '), directory.get(3) === directory.get(3), directory.get(3)?.name)
  const streamed: User[] = []
  for await (const user of stream<User>(users.map(user => JSON.stringify(user)))) streamed.push(user)
  console.log(streamed.map(describe).join('|'), streamed.some(user => user === guest))
  ada.name = 'Ada L'; ada.tags.push('z'); ada.address = { city: 'Turin' }
  console.log(describe(directory.get(1)!), describe(ada), Object.keys(ada).join(','))
}
await main(new RpcApi(new Rpc(server)))

// GENERATED: withDefaults stream on
// CHECK-LABEL: function {{*}}name="withDefaults"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_3]]
// CHECK-NEXT: CopyDataProperties v1, v0
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean}
// CHECK-NEXT: PropDefine v1, v4 key="active"
// CHECK-NEXT: v6 = FinishObject v1
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stream"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|AsyncGenerator<undefined|null|[[L_6]]> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2
// CHECK-NEXT: v4 = IteratorOpen v2
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: v10 = Convert v8 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v11 = Builtin builtin=JSON
// CHECK-NEXT: v12 = PropGet v11 key="parse"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v14 = Call v13, v11, v10 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_6]] site=[[w_8]]} illTypedCause=FromLooseType
// CHECK-NEXT: v17 = Await v16, v2
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_6]] site=[[w_9]]} illTypedCause=FromLooseType
// CHECK-NEXT: v19 = Yield v18, v2
// CHECK-NEXT: v20 = ResultAt v19
// CHECK-NEXT: v21 = ResultAt v19 index=1
// CHECK-NEXT: Switch v21 cases=[1, 2] -> case b6(), case b7(), otherwise b9()
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: Throw v20
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: Jump -> next b8(v20)
// CHECK-NEXT: b8(v22):
// CHECK-NEXT: IteratorClose v4
// CHECK-NEXT: Return v22
// CHECK-NEXT: b9() handler=b10():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b10() role=IterationCleanup subject=v4:
// CHECK-NEXT: v24 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="on"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=2 thisType={type=[[L_10]] site=[[w_11]]} parameters=[{type=undefined|null|[[L_12]] site=[[w_13]]}, {type=undefined|null|[[f_14]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_10]], v1: undefined|null|[[L_12]], v2: undefined|null|[[f_14]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v0 key="handlers"
// CHECK-NEXT: v4 = TypeTest v1 testedType=object
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: v6 = RequireObjectCoercible v3 nullishAccess=Update
// CHECK-NEXT: v7 = ToPropertyKey v5
// CHECK-NEXT: Jump -> next b4(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = ElemGet v3, v9{{*}} callers
// CHECK-NEXT: v11 = TypeTest v10 testedType=undefined|null
// CHECK-NEXT: Branch v11 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v12):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v13 = Data data=[[d_16]]
// CHECK-NEXT: ElemSet v3, v9, v13
// CHECK-NEXT: Jump -> next b8(v13)
// CHECK-NEXT: b7(v15):
// CHECK-NEXT: Jump -> next b8(v15)
// CHECK-NEXT: b8(v16):
// CHECK-NEXT: v17 = PropGet v16 key="push"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v19 = Call v18, v16, v2 calleeKey="push" calleeName="push"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
