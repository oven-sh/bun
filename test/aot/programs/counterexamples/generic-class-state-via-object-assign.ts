// `this.state = Object.assign({}, this.state, part)` in a generic base class; methods take `Pick`s of the state.
declare const console: { log(...values: unknown[]): void };
type State = { count: number; name: string; list: number[] };
class Component<S> { state!: S; setState(part: Partial<S>): void { this.state = Object.assign({}, this.state, part); } }
class Counter extends Component<State> {
  constructor() { super(); this.state = { count: 0, name: "n", list: [] }; }
  shouldUpdate(next: Pick<State, "count">): boolean { return next.count !== this.state.count; }
  didUpdate(prev: Pick<State, "name" | "list">): string { return prev.name + prev.list.length; }
  snapshot(prev: Readonly<{ count: number }>): number { return prev.count; }
}
const c = new Counter(); const before = c.state;
c.setState({ count: 1 }); console.log(c.shouldUpdate(before), c.didUpdate(before), c.snapshot(before), c.shouldUpdate(c.state), c.didUpdate(c.state), JSON.stringify(c.state));
c.setState(JSON.parse('{"name":"m"}')); console.log(c.didUpdate(c.state), c.snapshot(c.state), c.shouldUpdate(before));
