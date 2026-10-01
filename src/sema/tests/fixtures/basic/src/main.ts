import describe, { area, Color, Counter, makePoint, origin, type Point, type Shape } from './shapes.ts'
import * as shapes from './shapes.ts'

const shapesList: Shape[] = [
  { kind: 'circle', center: origin, radius: 2 },
  { kind: 'square', corner: { x: 1, y: 1 }, side: 3 },
]

const areas = shapesList.map(s => area(s))
const circles = shapesList.filter(s => s.kind === 'circle')
const hasBig = shapesList.some(s => area(s) > 10)
const found = shapesList.find(s => s.kind === 'square')
const total = areas.reduce((a, b) => a + b, 0)

const counter = new Counter('main')
counter.increment()
const last = counter.last
const made = Counter.create('other').increment(2)

const p = makePoint(1, 2)
const px = p.x
const text = describe(p)
const upper = text.toUpperCase().split(',')
const first = upper[0]

const byName = new Map<string, Point>()
byName.set('origin', origin)
const got = byName.get('origin')
const gx = got?.x
const names = [...byName.keys()]

async function load(id: number): Promise<Point> {
  return { x: id, y: id }
}

async function run() {
  const loaded = await load(1)
  const all = await Promise.all([load(1), load(2)])
  return loaded.x + all.length
}

function pick(flag: boolean, value: string | number | undefined) {
  if (typeof value === 'string') {
    return value.length
  }
  if (value === undefined) {
    return flag ? 1 : 0
  }
  return value + 1
}

const color = Color.Green
const ns = shapes.origin.y
const { x: dx, y: dy = 5, label } = origin
const [h, ...rest] = areas
let maybe: Point | null = null
const obj = { a: 1, b: 'two', nested: { c: true }, list: [1, 2, 3], fn: (n: number) => n * 2 }
const doubled = obj.fn(obj.a)
for (const s of shapesList) {
  s.kind
}
for (const [k, v] of byName) {
  k.length
  v.x
}
run().then(n => n.toFixed(2))
export { pick, total, circles, hasBig, found, last, made, px, first, gx, names, color, ns, dx, dy, label, h, rest, maybe, doubled }
