declare const console: { log(...values: unknown[]): void };

const events: string[] = [];
function flushEvents(): string {
    const text = events.join(",");
    events.length = 0;
    return text;
}
function describe(value: unknown): string {
    return typeof value === "symbol" ? "symbol" : typeof value + ":" + String(value);
}
function report(name: string, run: () => unknown): void {
    let text: string;
    try { text = describe(run()); } catch (error) { text = "threw " + (error as Error).name; }
    console.log(name + " -> " + text + " [" + flushEvents() + "]");
}
function read(array: unknown[], key: any): unknown { return array[key]; }
function store(array: unknown[], key: any, value: unknown): unknown { array[key] = value; return array.length; }

class Stack<T> extends Array<T> {
    push(...items: T[]): number {
        events.push("own push");
        return super.push(...items);
    }
    slice(start?: number, end?: number): T[] {
        events.push("own slice");
        return super.slice(start, end);
    }
}
Object.defineProperty(Stack.prototype, "4", {
    get() { events.push("get 4"); return "from getter"; },
    set(value: unknown) { events.push("set 4 " + String(value)); },
    configurable: true,
});

const marker = Symbol("marker");
const keys: [string, any][] = [
    ["0", 0], ["1", 1], ["4", 4], ["9", 9], ["-1", -1], ["1.5", 1.5], ["string 1", "1"],
    ["string name", "name"], ["null", null], ["undefined", undefined], ["symbol", marker], ["length", "length"],
];

function makeStack(): Stack<unknown> {
    const stack = new Stack<unknown>();
    stack.push("a", "b", "c");
    flushEvents();
    return stack;
}
function makeProxied(): unknown[] {
    const array: unknown[] = ["a", "b", "c"];
    const handler: ProxyHandler<any> = {
        get(target: any, key: string | symbol, receiver: unknown): unknown {
            events.push("trap get " + String(key));
            return Reflect.get(target, key, receiver);
        },
        set(target: any, key: string | symbol, value: unknown, receiver: unknown): boolean {
            events.push("trap set " + String(key));
            return Reflect.set(target, key, value, receiver);
        },
    };
    Object.setPrototypeOf(array, new Proxy(Array.prototype, handler));
    return array;
}
function makePlain(): unknown[] { return ["a", "b", "c"]; }

const makers: [string, () => unknown[]][] = [["stack", makeStack], ["proxied", makeProxied], ["plain", makePlain]];
for (const [name, make] of makers) {
    for (const [label, key] of keys) {
        report(name + " read " + label, () => read(make(), key));
        if (label !== "length")
            report(name + " store " + label, () => { const array = make(); const length = store(array, key, "new"); return String(length) + " " + String(read(array, key)); });
    }
}

report("own push runs", () => { const stack = makeStack(); return stack.push("d"); });
report("own slice runs", () => makeStack().slice(1).length);
report("slice keeps subclass", () => makeStack().slice(1) instanceof Stack);
report("spread of subclass", () => [...makeStack()].join("|"));
report("literal from proxied", () => [...makeProxied()].length);

function sumNumbers(values: number[]): number {
    let sum = 0;
    for (let index = 0; index < values.length; index++) sum += values[index];
    return sum;
}
const numbers: number[] = [1, 2, 3];
numbers[1] = 20;
numbers[3] = 4.5;
numbers.push(5);
report("plain numbers sum", () => sumNumbers(numbers));
report("plain numbers slice", () => numbers.slice(1, 3).join("|"));
report("plain numbers past the end", () => numbers[100]);
