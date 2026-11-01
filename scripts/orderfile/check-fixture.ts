// What `bun check`, `bun lint` and `bun fmt` are traced on (see generate.ts). It has to pass all three: a workload that
// exits with an error costs the build its order file. Its tsconfig.json leaves `skipLibCheck` off, so the default
// library is checked too.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface Shape {
  readonly kind: string;
  area(): number;
}

class Circle implements Shape {
  readonly kind = "circle";
  constructor(readonly radius: number) {}
  area() {
    return Math.PI * this.radius ** 2;
  }
}

class Rect implements Shape {
  readonly kind: "rect" | "square" = "rect";
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}
  area() {
    return this.width * this.height;
  }
}

class Square extends Rect {
  override readonly kind = "square";
  constructor(side: number) {
    super(side, side);
  }
}

enum Level {
  Low,
  High,
}

namespace Units {
  export const perInch = 2.54;
  export function toInches(cm: number) {
    return cm / perInch;
  }
}

type Event = { type: "open"; path: string } | { type: "close"; code: number } | { type: "data"; bytes: Uint8Array };
type EventOf<K extends Event["type"]> = Extract<Event, { type: K }>;
type Handlers = { [K in Event["type"] as `on${Capitalize<K>}`]: (event: EventOf<K>) => void };
type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
type Head<T extends unknown[]> = T extends [infer H, ...unknown[]] ? H : never;
type Awaitable<T> = T | Promise<T>;

function describe(event: Event): string {
  switch (event.type) {
    case "open":
      return event.path;
    case "close":
      return String(event.code);
    case "data":
      return `${event.bytes.length} bytes`;
  }
}

function pick<T extends object, K extends keyof T>(from: T, ...keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = from[key];
  return out;
}

function first(list: string): string;
function first<T>(list: readonly T[]): T | undefined;
function first(list: string | readonly unknown[]) {
  return list[0];
}

function isShape(value: unknown): value is Shape {
  return typeof value === "object" && value !== null && "area" in value;
}

function* count(to: number) {
  for (let i = 0; i < to; i++) yield i;
}

async function total(shapes: Awaitable<Shape>[]) {
  let sum = 0;
  for await (const shape of shapes) sum += shape.area();
  return sum;
}

class Store<T extends { id: number }> {
  #items = new Map<number, T>();
  add(item: T) {
    this.#items.set(item.id, item);
    return this;
  }
  get(id: number) {
    return this.#items.get(id);
  }
  map<U>(fn: (item: T) => U) {
    return [...this.#items.values()].map(fn);
  }
}

const handlers: Handlers = {
  onOpen: event => console.log(event.path),
  onClose: event => console.log(event.code),
  onData: event => console.log(event.bytes.length),
};

const shapes: Shape[] = [new Circle(1), new Rect(2, 3), new Square(4)];
const config = { name: "fixture", tags: ["a", "b"], nested: { level: Level.High } } satisfies Json;
const frozen: DeepReadonly<typeof config> = config;
const head: Head<[number, string]> = 1;
const store = new Store<{ id: number; label: string }>().add({ id: 1, label: "one" });
const byKind = Object.groupBy(shapes, shape => shape.kind);
const { name, ...rest } = pick(config, "name", "tags");

handlers.onOpen({ type: "open", path: describe({ type: "close", code: head }) });
console.log(
  first("abc"),
  first(shapes)?.area(),
  isShape(shapes[0]),
  [...count(3)],
  await total(shapes),
  store.get(1)?.label,
  store.map(item => item.label.toUpperCase()),
  Object.keys(byKind),
  frozen.nested.level,
  Units.toInches(10),
  name,
  rest.tags,
);

export {};
