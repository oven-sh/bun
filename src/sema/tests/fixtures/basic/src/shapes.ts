export interface Point {
  x: number
  y: number
  label?: string
}

export type Circle = { kind: 'circle'; center: Point; radius: number }
export type Square = { kind: 'square'; corner: Point; side: number }
export type Shape = Circle | Square

export class Counter {
  count = 0
  readonly name: string
  private history: number[] = []
  constructor(name: string) {
    this.name = name
  }
  increment(by = 1): number {
    this.count += by
    this.history.push(this.count)
    return this.count
  }
  get last() {
    return this.history[this.history.length - 1]
  }
  static create(name: string) {
    return new Counter(name)
  }
}

export function area(shape: Shape): number {
  if (shape.kind === 'circle') {
    return Math.PI * shape.radius ** 2
  }
  return shape.side * shape.side
}

export const origin: Point = { x: 0, y: 0 }

export function makePoint(x: number, y: number) {
  return { x, y }
}

export enum Color {
  Red,
  Green,
  Blue,
}

export default function describe(p: Point) {
  return `${p.x},${p.y}`
}

// What refers to itself without end has to come to some answer.
class GrowsForever<A, B> extends GrowsForever<A[], { x: B }[]> {}
class RoundA<T> extends RoundB<T> {}
class RoundB<T> extends RoundA<T> {}
interface LoopI<T> extends LoopI<T[]> {
  own: T
}
type NeverSettles = string | Promise<NeverSettles>
type NeverSettles2 = 1 | Promise<NeverSettles2> | NeverSettles2[]
export async function endlessThings(a: NeverSettles, b: NeverSettles2, i: LoopI<number>) {
  const grown = new GrowsForever()
  const round = new RoundB<string>()
  return [grown, round, await a, await b, i.own] as const
}
