// Object.defineProperty with a descriptor that is written out, on what a function hands back: texts, numbers, booleans, nothing, a bigint, a symbol, and objects.
function handBack<T>(value: T): T {
    let held: T = value;
    const read = (): T => held;
    return read();
}
const lines: string[] = [];
function outer(): void {
    function define(): void {
        let count: bigint = (0 as unknown as bigint);
        const text: any = handBack<any>("has value");
        try {
            Object.defineProperty(text, "size", { get() { return "text"; }, configurable: true });
            lines.push("text: defined");
        } catch (error) {
            lines.push("text: " + String(error));
        }
        const integer: any = handBack<any>(7);
        try {
            Object.defineProperty(integer, "size", { value: 1, writable: true });
            lines.push("integer: defined");
        } catch (error) {
            lines.push("integer: " + String(error));
        }
        const fraction: any = handBack<any>(1.5);
        try {
            Object.defineProperty(fraction, "size", { value: 1, enumerable: true });
            lines.push("fraction: defined");
        } catch (error) {
            lines.push("fraction: " + String(error));
        }
        const flag: any = handBack<any>(true);
        try {
            Object.defineProperty(flag, "size", { set(value: number) { lines.push("set " + value); } });
            lines.push("flag: defined");
        } catch (error) {
            lines.push("flag: " + String(error));
        }
        const nothing: any = handBack<any>(undefined);
        try {
            Object.defineProperty(nothing, "size", { value: 1 });
            lines.push("undefined: defined");
        } catch (error) {
            lines.push("undefined: " + String(error));
        }
        const empty: any = handBack<any>(null);
        try {
            Object.defineProperty(empty, "size", { value: 1 });
            lines.push("null: defined");
        } catch (error) {
            lines.push("null: " + String(error));
        }
        const large: any = handBack<any>(10n);
        try {
            Object.defineProperty(large, "size", { value: 1 });
            lines.push("bigint: defined");
        } catch (error) {
            lines.push("bigint: " + String(error));
        }
        const symbol: any = handBack<any>(Symbol.iterator);
        try {
            Object.defineProperty(symbol, "size", { value: 1 });
            lines.push("symbol: defined");
        } catch (error) {
            lines.push("symbol: " + String(error));
        }
        const object: any = handBack<any>({ width: 2 });
        try {
            Object.defineProperty(object, "size", { get() { return this.width * 2; }, configurable: true });
            lines.push("object: defined " + object.size + " " + Object.keys(object).join());
        } catch (error) {
            lines.push("object: " + String(error));
        }
        const list: any = handBack<any>([1, 2]);
        try {
            const same = Object.defineProperty(list, "size", { value: 3, enumerable: true });
            lines.push("list: defined " + (same === list) + " " + same.size + " " + Object.keys(same).join());
        } catch (error) {
            lines.push("list: " + String(error));
        }
        function bump(): void {
            ++(count as any);
        }
        try {
            // @ts-ignore
            handBack<number>((missing as any).call(bump, 8));
        } catch (error) {
        }
    }
    for (let turn = 0; turn < 3; turn++)
        handBack<any>(define() as any);
}
(globalThis as any).keep = outer;
(globalThis as any).keep();
console.log(lines.join("\n"));
