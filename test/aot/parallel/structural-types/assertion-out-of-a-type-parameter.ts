// The shape: one generic holder of state, used with several unrelated state types; an updater arrow typed by the holder's type parameter.
type Action<S> = S | ((previous: S) => S);
function hold<S>(initial: S): [() => S, (action: Action<S>) => void] {
  let value = initial;
  return [() => value, action => { value = typeof action === "function" ? (action as (previous: S) => S)(value) : action; }];
}
type Flow = { state: "idle"; tries: number } | { state: "confirm"; account: string; saving?: boolean } | { state: "done"; at: number };
type Point = { x: number; y: number };
type Named = { name: string; tags: string[] };
type Sized = { width: number; height: number; depth: number };
const [flow, setFlow] = hold<Flow>({ state: "idle", tries: 0 });
const [point, setPoint] = hold<Point>({ x: 1, y: 2 });
const [named, setNamed] = hold<Named>({ name: "n", tags: [] });
const [sized, setSized] = hold<Sized>({ width: 1, height: 2, depth: 3 });
setFlow({ state: "confirm", account: "a" });
setFlow(current => (current.state === "confirm" ? { ...current, saving: true } : current));
setPoint(current => ({ ...current, x: current.x + 1 }));
setNamed(current => ({ ...current, name: current.name + "!" }));
setSized({ width: 4, height: 5, depth: 6 });
function stateOf<S>(value: S): string | undefined {
  return (value as Flow).state;
}
console.log(JSON.stringify([flow(), point(), named(), sized()]), stateOf(flow()), stateOf(point()), stateOf(named()), stateOf(sized()));
