// A member of an object literal under a well-known symbol: other well known symbols in literals.
const money: any = { cents: 250, [Symbol.toPrimitive](hint: string) { return hint === "number" ? this.cents : "$2.50"; }, [Symbol.toStringTag]: "Money" };
const even = { [Symbol.hasInstance](n: number) { return n % 2 === 0; } };
const spreadable: any = { length: 2, 0: "a", 1: "b", [Symbol.isConcatSpreadable]: true };
console.log(+money, `${money}`, money + 1, Object.prototype.toString.call(money), (2 as any) instanceof (even as any), (3 as any) instanceof (even as any), ["x"].concat(spreadable).join());
money[Symbol.toPrimitive] = () => 1; delete money[Symbol.toStringTag]; console.log(+money, Object.prototype.toString.call(money));
