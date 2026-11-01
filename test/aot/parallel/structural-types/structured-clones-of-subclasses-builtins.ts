// Structured clones of subclasses of built ins.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Stack extends Array<number> {
  label = "stack";
  top(): number | undefined {
    return this[this.length - 1];
  }
}

class Registry extends Map<string, number> {
  label = "registry";
  total(): number {
    let sum = 0;
    for (const value of this.values()) sum += value;
    return sum;
  }
}

class Bag extends Set<number> {
  first(): number | undefined {
    return [...this][0];
  }
}

class Failure extends Error {
  code = 7;
  name = "Failure";
  describe(): string {
    return this.name + " " + this.code;
  }
}

class Moment extends Date {
  label(): string {
    return "at " + this.getTime();
  }
}

class Bytes extends Uint8Array {
  sum(): number {
    let total = 0;
    for (const byte of this) total += byte;
    return total;
  }
}

function stackOf(...values: number[]): Stack {
  const stack = new Stack();
  stack.push(...values);
  return stack;
}

function topOf(stack: Stack): number | undefined {
  return stack.top();
}

function total(registry: Registry): number {
  return registry.total();
}

function describe(failure: Failure): string {
  return failure.describe();
}

function sum(bytes: Bytes): number {
  return bytes.sum();
}

let warm = 0;
for (let i = 0; i < 1000; i++) {
  warm += (topOf(stackOf(i)) ?? 0) + total(new Registry([["a", i]])) + describe(new Failure("f")).length + sum(new Bytes([1, 2])) + (new Bag([i]).first() ?? 0) + new Moment(i).label().length;
}
console.log("after 1000 honest values", warm);

attempt("a stack: elements and length", () => {
  const clone = structuredClone(stackOf(1, 2, 3));
  return [clone.length, clone[2], Array.isArray(clone), [...clone]];
});
attempt("a stack: its class and its field", () => {
  const clone = structuredClone(stackOf(1, 2, 3));
  return [clone instanceof Stack, clone.constructor === Array, clone.label, Object.keys(clone)];
});
attempt("a stack: its method", () => topOf(structuredClone(stackOf(1, 2, 3))));
attempt("a stack: push still works", () => structuredClone(stackOf(1)).push(2));
attempt("a registry: entries", () => {
  const clone = structuredClone(new Registry([["a", 1]]));
  return [clone.size, clone.get("a"), clone instanceof Registry, clone instanceof Map, clone.label];
});
attempt("a registry: its method", () => total(structuredClone(new Registry([["a", 1]]))));
attempt("a bag", () => {
  const clone = structuredClone(new Bag([4, 5]));
  return [clone.size, clone.has(4), clone instanceof Bag, typeof clone.first];
});
attempt("a bag: its method", () => structuredClone(new Bag([4, 5])).first());
attempt("a failure", () => {
  const clone = structuredClone(new Failure("broken"));
  return [clone.message, clone.name, clone.code, clone instanceof Failure, clone instanceof Error, typeof clone.stack];
});
attempt("a failure: its method", () => describe(structuredClone(new Failure("broken"))));
attempt("a moment", () => {
  const clone = structuredClone(new Moment(5));
  return [clone.getTime(), clone instanceof Moment, clone instanceof Date];
});
attempt("a moment: its method", () => structuredClone(new Moment(5)).label());
attempt("bytes", () => {
  const clone = structuredClone(new Bytes([1, 2, 3]));
  return [clone.length, clone[1], clone instanceof Bytes, clone instanceof Uint8Array];
});
attempt("bytes: its method", () => sum(structuredClone(new Bytes([1, 2, 3]))));
attempt("honest again", () => [topOf(stackOf(1, 2)), total(new Registry([["a", 1]])), describe(new Failure("f")), sum(new Bytes([1, 2]))]);
