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
