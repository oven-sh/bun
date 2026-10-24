// Programs that live on parsed data: a fetch wrapper, a reducer over parsed actions, settings with fallbacks, models built from JSON, a small schema library, groupBy and type guards. Every value matches its declared type. The program must behave as in plain Bun.
interface Item { id: number; title: string; done: boolean; due?: string; labels: string[] }
type Action = { type: 'add'; item: Item } | { type: 'remove'; id: number } | { type: 'toggle'; id: number } | { type: 'rename'; id: number; title: string }
interface State { items: Item[]; count: number; last?: Action['type'] }
interface Settings { theme: 'dark' | 'light'; size: number; recent: string[]; nested: { depth: number; on: boolean } }

class FakeResponse { constructor(private body: string, public status: number) {} json(): Promise<any> { return Promise.resolve(JSON.parse(this.body)) } get ok(): boolean { return this.status < 400 } }
const pages: Record<string, string> = {
  '/items': '[{"id":1,"title":"one","done":false,"labels":["x"]},{"id":2,"title":"two","done":true,"due":"2026-01-02","labels":[]}]',
  '/item/1': '{"id":1,"title":"one","done":false,"labels":["x"]}',
  '/settings': '{"theme":"dark","size":12,"recent":["a","b"],"nested":{"depth":2,"on":true}}',
}
function fakeFetch(url: string): Promise<FakeResponse> { return Promise.resolve(new FakeResponse(pages[url] ?? 'null', url in pages ? 200 : 404)) }
async function getJson<T>(url: string): Promise<T> { const response = await fakeFetch(url); return response.json() as Promise<T> }
function getJsonThen<T>(url: string): Promise<T> { return fakeFetch(url).then(response => response.json()) }
async function getOrNull<T>(url: string): Promise<T | null> { const response = await fakeFetch(url); if (!response.ok) return null; return await response.json() }

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'add': return { items: [...state.items, action.item], count: state.count + 1, last: action.type }
    case 'remove': return { items: state.items.filter(item => item.id !== action.id), count: state.count - 1, last: action.type }
    case 'toggle': return { ...state, items: state.items.map(item => item.id === action.id ? { ...item, done: !item.done } : item), last: action.type }
    case 'rename': return { ...state, items: state.items.map(item => item.id === action.id ? { ...item, title: action.title } : item), last: 'rename' }
  }
}
function show(item: Item): string { return `${item.id}/${item.title}/${item.done}/${item.due ?? '-'}/${item.labels.length}` }

const store = new Map<string, string>([['settings', pages['/settings']!], ['count', '3']])
function load<T>(key: string, fallback: T): T { const raw = store.get(key); return raw ? JSON.parse(raw) : fallback }
const defaults: Settings = { theme: 'light', size: 10, recent: [], nested: { depth: 0, on: false } }

class Model {
  id = 0; title = ''; labels: string[] = []
  static fromJSON(json: any): Model { return Object.assign(new Model(), json) }
  get label(): string { return this.id + ':' + this.title + ':' + this.labels.join() }
}
class Wrapper { constructor(public item: Item, private seen = 0) {} touch(): number { return ++this.seen } get title(): string { return this.item.title.toUpperCase() } }

type Schema<T> = { parse(value: unknown): T }
const text = (): Schema<string> => ({ parse(value) { if (typeof value !== 'string') throw new Error('not a string'); return value } })
const count = (): Schema<number> => ({ parse(value) { if (typeof value !== 'number') throw new Error('not a number'); return value } })
function shape<S extends Record<string, Schema<unknown>>>(fields: S): Schema<{ [K in keyof S]: S[K] extends Schema<infer T> ? T : never }> {
  return { parse(value) { const given = value as Record<string, unknown>; for (const key in fields) fields[key]!.parse(given[key]); return value as any } }
}
function list<T>(of: Schema<T>): Schema<T[]> { return { parse(value) { if (!Array.isArray(value)) throw new Error('not a list'); value.forEach(one => of.parse(one)); return value } } }
const point = shape({ name: text(), x: count(), y: count() })
function norm(p: { x: number; y: number }): number { return Math.abs(p.x) + Math.abs(p.y) }
function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> { const out = {} as Record<K, T[]>; for (const item of items) (out[key(item)] ??= []).push(item); return out }
function hasTitle(value: unknown): value is { title: string } { return typeof value === 'object' && value !== null && 'title' in value && typeof (value as any).title === 'string' }

async function main(): Promise<void> {
  const items = await getJson<Item[]>('/items')
  console.log(items.map(show).join(' '))
  const one = await getJsonThen<Item>('/item/1')
  const none = await getOrNull<Item>('/missing')
  const two = await getOrNull<Item>('/item/1')
  console.log(show(one), none, two && show(two), one === two)
  let state: State = { items, count: items.length }
  const lines = ['{"type":"add","item":{"id":3,"title":"three","done":false,"labels":["y","z"]}}', '{"type":"toggle","id":1}', '{"type":"rename","id":2,"title":"TWO"}', '{"type":"remove","id":3}', '{"type":"add","item":{"id":4,"title":"four","done":true,"labels":[]}}']
  for (const line of lines) { const action: Action = JSON.parse(line); state = reduce(state, action); console.log(state.last, state.count, state.items.map(show).join(' ')) }
  const settings = load('settings', defaults)
  const missing = load('nothing', defaults)
  const merged: Settings = { ...defaults, ...JSON.parse('{"size": 14, "nested": {"depth": 5, "on": true}}') }
  console.log(settings.theme, settings.size, settings.recent.join(), settings.nested.depth, missing === defaults, merged.theme, merged.size, merged.nested.depth, load('count', 0) + 1)
  const model = Model.fromJSON(JSON.parse(pages['/item/1']!))
  console.log(model.label, model instanceof Model, Object.keys(model).join())
  const wrapper = new Wrapper(one)
  console.log(wrapper.title, wrapper.touch(), wrapper.touch(), wrapper.item === one)
  const points = list(point).parse(JSON.parse('[{"name":"a","x":1,"y":-2},{"name":"b","x":3,"y":4}]'))
  console.log(points.map(p => p.name + norm(p)).join(), norm(point.parse(JSON.parse('{"name":"c","x":5,"y":5}'))))
  try { point.parse(JSON.parse('{"name":"d","x":"5","y":5}')) } catch (e) { const error = e as { message: string; code?: string }; console.log(error.message, error.code) }
  const groups = groupBy(state.items, item => item.done ? 'done' : 'open')
  console.log(Object.keys(groups).sort().map(key => key + ':' + groups[key as 'done' | 'open'].map(item => item.id).join('+')).join(' '))
  const byId = new Map<string, Item>(Object.entries(JSON.parse('{"a": {"id":7,"title":"seven","done":false,"labels":[]}}')))
  const [first, total]: [Item, number] = JSON.parse('[{"id":8,"title":"eight","done":true,"labels":["q"]}, 2]')
  console.log(show(byId.get('a')!), show(first), total)
  const unknowns: unknown[] = JSON.parse('[1, {"title": "t"}, null, {"other": 2}, "s"]')
  console.log(unknowns.filter(hasTitle).map(value => value.title).join(), unknowns.length)
  const patch: Partial<Item> = JSON.parse('{"title": "patched", "done": true}')
  Object.assign(one, patch)
  console.log(show(one), show({ ...first, ...patch }))
}
await main()
