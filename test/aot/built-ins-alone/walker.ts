import { literalOf, memberOf, within } from "./evaluate";

const globalClasses = [
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "WeakRef",
  "Promise",
  "Date",
  "RegExp",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Buffer",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "URL",
  "URLSearchParams",
  "Headers",
  "Request",
  "Response",
  "Blob",
  "ReadableStream",
  "Iterator",
  "Number",
  "String",
  "Boolean",
  "Symbol",
  "BigInt",
] as const;

function classOf(value: object): string | null {
  for (const name of globalClasses) {
    const constructor = (globalThis as Record<string, unknown>)[name];
    if (typeof constructor === "function" && Object.getPrototypeOf(value) === constructor.prototype) return name;
  }
  return null;
}

const isPrimitiveKey = (key: unknown) => ["string", "number", "boolean"].includes(typeof key);

export class Walker {
  lines: string[] = [];
  private names = 0;
  private waiting: string[] = [];

  constructor(
    private isVolatile: boolean,
    private known: Map<unknown, string>,
    private most = 14,
  ) {}

  get isFull(): boolean {
    return this.lines.length >= this.most;
  }

  private flush(): void {
    if (this.waiting.length > 0) this.lines.push(`console.log(${this.waiting.join(", ")});`);
    this.waiting = [];
  }

  private print(...expressions: string[]): void {
    if (this.waiting.length + expressions.length > 5) this.flush();
    this.waiting.push(...expressions);
  }

  private statement(...text: string[]): void {
    this.flush();
    this.lines.push(...text);
  }

  private fresh(word: string): string {
    this.names++;
    return this.names === 1 ? word : `${word}${this.names}`;
  }

  finish(): string[] {
    this.flush();
    return this.lines;
  }

  async walk(value: unknown, text: string, depth: number): Promise<void> {
    if (this.isFull) return;
    const name = this.known.get(value);
    if (typeof value === "object" && value?.constructor?.name === "Item") {
      return this.print(...(name === undefined ? [] : [`${text} === ${name}`]), `${text}.double()`);
    }
    if (name !== undefined && name !== text) return this.print(`${text} === ${name}`);
    switch (typeof value) {
      case "undefined":
        return this.print(`typeof ${text}`, `${text} === undefined`);
      case "boolean":
        return this.isVolatile ? this.print(`typeof ${text}`) : this.print(`typeof ${text}`, text);
      case "number":
        if (this.isVolatile) return this.print(`typeof ${text}`);
        return value === 0
          ? this.print(`typeof ${text}`, `${text} + 1`, `1 / ${text}`)
          : this.print(`typeof ${text}`, `${text} + 1`);
      case "string":
        return this.isVolatile ? this.print(`typeof ${text}`) : this.print(`typeof ${text}`, `${text}.length`, text);
      case "bigint":
        return this.isVolatile ? this.print(`typeof ${text}`) : this.print(`typeof ${text}`, `${text} + 1n`);
      case "symbol":
        return this.print(`typeof ${text}`, `${text}.description`);
      case "function":
        return this.print(`typeof ${text}`, `${text}.length`);
    }
    if (value === null) return this.print(`${text} === null`);
    await this.walkObject(value as object, text, depth);
  }

  private async walkObject(value: object, text: string, depth: number): Promise<void> {
    if (value instanceof Promise) return this.walkPromise(value, text, depth);
    if (Array.isArray(value)) return this.walkArray(value, text, depth);
    const name = classOf(value);
    if (value instanceof Error) {
      return this.print(
        `${text} instanceof ${value.constructor === Error || !(value.constructor.name in globalThis) ? "Error" : value.constructor.name}`,
        `${text}.message`,
      );
    }
    if (name !== null) this.print(`${text} instanceof ${name}`);
    else this.print(`typeof ${text}`);
    if (value instanceof Map) {
      this.print(`${text}.size`);
      if (depth === 0) return;
      for (const [key, each] of [...value].slice(0, 2)) {
        if (isPrimitiveKey(key)) await this.walk(each, `${text}.get(${literalOf(key)})`, depth - 1);
      }
      if ([...value.keys()].every(isPrimitiveKey)) this.print(`[...${text}.keys()].join()`);
      return;
    }
    if (value instanceof Set) {
      this.print(`${text}.size`);
      if (depth === 0) return;
      const values = [...value];
      for (const each of values.slice(0, 2)) if (isPrimitiveKey(each)) this.print(`${text}.has(${literalOf(each)})`);
      if (values.length > 0)
        await this.walk(values[values.length - 1], `[...${text}][${values.length - 1}]`, depth - 1);
      return;
    }
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      const view = value as unknown as ArrayLike<number | bigint>;
      this.print(`${text}.length`);
      for (let index = 0; index < Math.min(view.length, 2) && depth > 0; index++)
        await this.walk(view[index], `${text}[${index}]`, 0);
      return;
    }
    if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return this.print(`${text}.byteLength`);
    if (value instanceof DataView) return this.print(`${text}.byteLength`, `${text}.byteOffset`);
    if (value instanceof Date) return this.isVolatile ? undefined : this.print(`${text}.getTime()`);
    if (value instanceof RegExp) return this.print(`${text}.source`, `${text}.flags`, `${text}.lastIndex`);
    if (
      value instanceof Number ||
      value instanceof String ||
      value instanceof Boolean ||
      name === "Symbol" ||
      name === "BigInt"
    ) {
      return this.walk(value.valueOf(), `${text}.valueOf()`, 0);
    }
    if (value instanceof WeakMap || value instanceof WeakSet || value instanceof WeakRef) return;
    if (value instanceof URL) return this.isVolatile ? undefined : this.print(`${text}.href`);
    if (depth === 0) return;
    if (typeof (value as Iterator<unknown>).next === "function")
      return this.walkIterator(value as Iterator<unknown>, text, depth);
    const keys = Object.keys(value);
    this.print(`Object.keys(${text}).join()`);
    for (const key of keys.slice(0, 4))
      await this.walk((value as Record<string, unknown>)[key], memberOf(text, key), depth - 1);
    if (keys.length === 0 && Symbol.iterator in value) {
      const items = this.fresh("items");
      this.statement(`const ${items} = [...${text}];`);
      await this.walkArray([...(value as Iterable<unknown>)], items, depth - 1);
    }
  }

  private async walkArray(value: unknown[], text: string, depth: number): Promise<void> {
    this.print(`Array.isArray(${text})`, `${text}.length`);
    if (depth === 0) return;
    for (let index = 0; index < Math.min(value.length, 4); index++) {
      if (index in value) await this.walk(value[index], `${text}[${index}]`, depth - 1);
      else this.print(`${index} in ${text}`);
    }
    const others = Object.keys(value).filter(key => !/^[0-9]+$/.test(key));
    for (const key of others.slice(0, 4))
      await this.walk((value as unknown as Record<string, unknown>)[key], memberOf(text, key), depth - 1);
  }

  private async walkPromise(value: Promise<unknown>, text: string, depth: number): Promise<void> {
    const pending = Symbol();
    let settled: unknown;
    let isRejected = false;
    try {
      settled = await within<unknown>(value, pending, 100);
    } catch (error) {
      settled = error;
      isRejected = true;
    }
    if (settled === pending) return this.print(`${text} instanceof Promise`);
    if (!isRejected) {
      const name = this.fresh("settled");
      this.statement(`const ${name} = await ${text};`);
      return this.walk(settled, name, depth);
    }
    const name = this.fresh("reason");
    this.statement(`let ${name};`, "try {", `  await ${text};`, "} catch (error) {", `  ${name} = error;`, "}");
    return this.walk(settled, name, depth);
  }

  private async walkIterator(value: Iterator<unknown>, text: string, depth: number): Promise<void> {
    const answer: unknown = value.next();
    const isAsync = answer instanceof Promise;
    const step = (await answer) as IteratorResult<unknown>;
    const name = this.fresh("step");
    this.statement(`const ${name} = ${isAsync ? "await " : ""}${text}.next();`);
    this.print(`${name}.done`);
    await this.walk(step.value, `${name}.value`, depth - 1);
    if (isAsync || !(Symbol.iterator in value)) return;
    let rest = 0;
    while (rest < 10 && !value.next().done) rest++;
    if (rest < 10) this.print(`[...${text}].length`);
  }
}
