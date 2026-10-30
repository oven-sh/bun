type Handler = (text: string) => string;
type Props = { id: number; label: string; onChange?: Handler; width?: number; note?: string };
type Wide = Props & { extra?: number; last?: string };

const shout: Handler = text => text.toUpperCase();
const handlers: unknown[] = [shout, shout.bind(null), 7, "text", null, undefined, { call: 1 }, Symbol.for("s")];

function propsWith(index: number, handler: unknown): Props {
  const props: Props = { id: index, label: "p" + index };
  (props as Record<string, unknown>).onChange = handler;
  props.width = index * 2;
  if (index % 3 === 0) props.note = "n" + index;
  return props;
}

function widen(props: Props, index: number): Wide {
  return { ...props, extra: index, last: "z" };
}

function withFirst(props: Props): Wide {
  return { last: "a", ...props };
}

function rest({ id, ...others }: Props) {
  return others;
}

function describe(value: object): string {
  return Reflect.ownKeys(value).map(key => {
    const item = (value as Record<PropertyKey, unknown>)[key];
    return String(key) + "=" + (typeof item === "function" ? "function " + (item as Handler)("x") : typeof item === "symbol" ? String(item) : JSON.stringify(item));
  }).join(",");
}

for (let round = 0; round < 6; round++) {
  for (let index = 0; index < handlers.length; index++) {
    const props = propsWith(index, handlers[(index + (round > 2 ? round : 0)) % handlers.length]);
    console.log(round, index, describe(widen(props, index)), "|", describe(withFirst(props)), "|", describe(rest(props)));
  }
}

type Empty = {};
type Point = { x: number; y: number };
function empty(): Empty { return {}; }
function onto(point: Point, nothing: Empty): Point { return { ...point, ...nothing }; }
function under(point: Point, nothing: Empty): Point { return { ...nothing, ...point }; }
function alone(nothing: Empty): Empty { return { ...nothing }; }
for (let index = 0; index < 4; index++) {
  const grown = empty();
  if (index > 1) (grown as Record<string, number>)["added" + index] = index;
  console.log(describe(onto({ x: index, y: 1 }, grown)), "|", describe(under({ x: index, y: 2 }, grown)), "|", describe(alone(grown)), "|", describe(alone(empty())));
}
