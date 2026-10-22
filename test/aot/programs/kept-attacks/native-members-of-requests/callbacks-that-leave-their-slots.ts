// Native members of requests: callbacks that leave their slots. It prints what plain Bun prints.
declare const process: { argv: string[] };
declare const console: { log(...values: unknown[]): void };
type Props = { onSubmit: (value: string) => number; onExit?: () => void; label: string };
const memo: unknown[] = [];
let cursor = 0;
function useCallback<T extends Function>(callback: T): T {
  const index = cursor++;
  return (memo[index] ??= callback) as T;
}
function useState<T>(initial: T): [T, (next: T) => void] {
  const index = cursor++;
  const cell = (memo[index] ??= { value: initial }) as { value: T };
  return [cell.value, next => { cell.value = next; }];
}
let total = 0;
function Input(props: Props): number {
  if (props.onExit) props.onExit();
  return props.onSubmit(props.label);
}
class Model {
  count = 0;
  add(value: string): number { return (this.count += value.length); }
}
const model = new Model();
function App(round: number): number {
  cursor = 0;
  const [text, setText] = useState("a");
  const plain = (value: string) => value.length + round;
  const memoized = useCallback((value: string) => value.length);
  const bound = model.add.bind(model);
  const fromAny: (value: string) => number = JSON.parse("[0]").map(() => (value: string) => value.length * 2)[0];
  let sum = 0;
  sum += Input({ onSubmit: plain, label: text });
  sum += Input({ onSubmit: memoized, label: text, onExit: () => setText("b") });
  sum += Input({ onSubmit: bound, label: text });
  sum += Input({ onSubmit: fromAny, label: text });
  sum += Input({ onSubmit: parseInt as (value: string) => number, label: "7" });
  return sum;
}
const rounds = Number(process.argv[2]);
for (let round = 0; round < rounds; round++) total += App(round);
console.log(total);
