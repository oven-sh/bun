// Every place where a later block reads an export of an earlier block.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

namespace Shop {
  export let stock: number = 3;
  export const label: string = "shop";
  export let missing: number;
}

namespace Shop.Back {
  export let shelves: number = 2;
}

namespace Shop {
  export function plain(): number {
    return stock;
  }
  export function shorthand(): { stock: number; label: string } {
    return { stock, label };
  }
  export function kind(): string[] {
    return [typeof stock, typeof label, typeof missing];
  }
  export function byDefault(n: number = stock): number {
    return n;
  }
  export function inTemplate(): string {
    return `${label}:${stock}`;
  }
  export function inClosure(): () => number {
    return () => stock * 2;
  }
  export function inList(): number[] {
    return [stock, ...[stock]];
  }
  export function asArgument(): number {
    return Math.max(stock, 1);
  }
  export function asKey(): Record<string, number> {
    return { [label]: stock };
  }
  export function neverStored(): unknown[] {
    return [missing, missing + 1, missing ?? "default"];
  }
  export class Clerk {
    seen: number = stock;
    static atStart: number = stock;
    count(): number {
      return stock + this.seen;
    }
  }
  export namespace Front {
    export function outer(): number {
      return stock;
    }
    export function sibling(): number {
      return Back.shelves;
    }
  }
  export const copied: number = stock;
}

namespace Shop.Back {
  export function shelvesNow(): number {
    return shelves;
  }
  export function stockNow(): number {
    return stock;
  }
}

function all(): unknown[] {
  return [
    Shop.plain(),
    Shop.shorthand(),
    Shop.kind(),
    Shop.byDefault(),
    Shop.inTemplate(),
    Shop.inClosure()(),
    Shop.inList(),
    Shop.asArgument(),
    Shop.asKey(),
    new Shop.Clerk().seen,
    new Shop.Clerk().count(),
    Shop.Clerk.atStart,
    Shop.Front.outer(),
    Shop.Front.sibling(),
    Shop.Back.shelvesNow(),
    Shop.Back.stockNow(),
    Shop.copied,
  ];
}

show("at first", () => all());
show("the one without a value", () => Shop.neverStored());
Shop.stock = 10;
Shop.Back.shelves = 20;
show("after stores from outside", () => all());
Shop.missing = 1;
show("the one without a value, stored", () => Shop.neverStored());
show("keys", () => [Object.keys(Shop), Object.keys(Shop.Back), Object.keys(Shop.Front)]);

let sum = 0;
for (let i = 0; i < 2000; i++) {
  Shop.stock = i;
  sum += Shop.plain() + Shop.byDefault() + Shop.Front.outer() + Shop.Back.stockNow();
}
show("2000 rounds", () => sum);
