// Methods found through instances, by the library: a subclass of EventEmitter or Readable overrides emit, on and push with narrower parameters, and the library's own code calls the overrides with its own events and listeners.
import { EventEmitter, once } from "node:events";
import { Readable } from "node:stream";

let total = 0;

class Numbers extends EventEmitter {
  emit(name: "value", value?: number): boolean {
    total += name === "value" ? 1 : typeof name === "string" ? 100 : 10000;
    return super.emit(name, value);
  }
  on(name: "value", listener: (value: number) => void): this {
    total += name === "value" ? 100000 : 1000000;
    return super.on(name, listener);
  }
}

const numbers = new Numbers();
numbers.on("value", () => {});
numbers.emit("value", 1);
const waiting = once(numbers, "value");
numbers.emit("value", 2);
await waiting;

class Source extends Readable {
  _read(): void {
    this.push("chunk");
    this.push(null);
  }
  emit(name: string, ...rest: unknown[]): boolean {
    total += name === "data" ? 10000000 : name === "end" ? 100000000 : 0;
    return super.emit(name, ...rest);
  }
}
for await (const chunk of new Source()) total += String(chunk).length;
await new Promise<void>(resolve => new Source().on("data", () => {}).on("close", resolve));
console.log(total);
