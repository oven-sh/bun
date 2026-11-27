// What a protocol of the language finds is entered by value out of the engine's and the library's own code: a conversion, JSON.stringify, an iteration, instanceof. Those entries stay open.
class Money {
  readonly cents: number;
  constructor(cents: number) {
    this.cents = cents;
  }
  toString(): string {
    return "$" + this.cents / 100;
  }
  valueOf(): number {
    return this.cents;
  }
  toJSON(): unknown {
    return { cents: this.cents };
  }
}
class Exact {
  [Symbol.toPrimitive](hint: string): string | number {
    return hint === "number" ? 4 : "four";
  }
}
class Range {
  readonly end: number;
  constructor(end: number) {
    this.end = end;
  }
  [Symbol.iterator]() {
    let next = 0;
    const end = this.end;
    return {
      next() {
        return next < end ? { done: false, value: next++ } : { done: true, value: undefined };
      },
      return() {
        return { done: true, value: undefined };
      },
    };
  }
}
class Even {
  static [Symbol.hasInstance](value: unknown): boolean {
    return typeof value === "number" && value % 2 === 0;
  }
}
const money = new Money(250);
const any: any = money;
console.log(money.toString(), money.valueOf(), `${money}`, any + 1, any * 2, JSON.stringify(money), JSON.stringify([money]), String(money));
const exact: any = new Exact();
console.log(`${exact}`, +exact, exact + "");
console.log([...new Range(3)].join(), Array.from(new Range(2)).join(), Math.max(...(new Range(4) as any)));
for (const n of new Range(5)) {
  if (n === 1) break;
}
const [head] = new Range(2) as any;
console.log(head, (2 as any) instanceof Even, (3 as any) instanceof Even);
