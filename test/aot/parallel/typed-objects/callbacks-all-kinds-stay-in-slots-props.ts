// The field of a function type takes every function: an arrow, a named function, one that came back from a memo or from code nobody knows, a bound function (React's setState is one),
// a function of the host. None of them takes the property out of its slot.
// COUNTER: FieldsLeftSlotByStoreOfOtherType = 0
const unknownCode = new Function("value", process.argv[2] ?? "return value") as <V>(value: V) => V;
interface Props { onChange: (value: string) => void; onSubmit: () => unknown; label: string }
let total = 0;
function Input(props: Props): number { props.onChange(props.label); props.onSubmit(); return Object.keys(props).length; }
const memo: unknown[] = [];
function useCallback<T extends Function>(callback: T, slot: number): T { return (memo[slot] ??= callback) as T; }
function useUnknown<T extends Function>(callback: T): T { return unknownCode(callback); }
function plain(value: string): void { total += value.length; }
class Owner { n = 1; handle(value: string): void { total += value.length + this.n; } static count(): void { total += 2; } }
const owner = new Owner();
const seen: unknown[] = [];
for (let i = 0; i < 50; i++) {
    let keys = 0;
    keys += Input({ onChange: value => { total += value.length; }, onSubmit: () => { total++; }, label: "x" });
    keys += Input({ onChange: plain, onSubmit: Owner.count, label: "xy" });
    keys += Input({ onChange: useCallback((value: string) => { total += value.length; }, 0), onSubmit: useCallback(() => { total++; }, 1), label: "x" });
    keys += Input({ onChange: useUnknown((value: string) => { total += value.length; }), onSubmit: useUnknown(() => { total++; }), label: "x" });
    keys += Input({ onChange: owner.handle.bind(owner), onSubmit: plain.bind(null, "bound"), label: "xyz" });
    keys += Input({ onChange: unknownCode(owner.handle.bind(owner)), onSubmit: Date.now, label: "x" });
    keys += Input({ onChange: new Function("value", "globalThis.lastValue = value") as (value: string) => void, onSubmit: Math.random, label: "text" });
    keys += Input({ onChange: async value => { total += value.length; }, onSubmit: function* () { total += 100; }, label: "x" });
    if (i === 0 || i === 49)
        seen.push(keys, total, (globalThis as { lastValue?: unknown }).lastValue);
}
console.log(seen.join(" | "));
