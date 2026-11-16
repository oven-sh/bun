function show(value: unknown): string {
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return `[${parts.join(" ")}]`;
  }
  return typeof value === "symbol" ? "symbol" : `${typeof value}:${Object.is(value, -0) ? "-0" : String(value)}`;
}

const numbers = [3, 1, 2].map(x => x + 1);
console.log(show(numbers.concat([4])), show(numbers.concat(5)), show(numbers.concat()), show([0].concat(numbers, numbers)));

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}
console.log(total(numbers.concat([0.5])), total(numbers.concat(7, 8)), show(total(numbers.concat(["text"] as any))), show(total(numbers.concat("9" as any))));
console.log(show(numbers.concat(null as any, undefined as any, true as any, 8n as any, Symbol.iterator as any)));
console.log(show([1].concat([[2, 3]] as any)), show([1].concat([, 2] as any)), show([, 1].concat([2])));

const spreadable: any = { length: 3, 0: "a", 2: "c", [Symbol.isConcatSpreadable]: true };
console.log(show(numbers.concat(spreadable)));
const opaque: any = [1, 2];
opaque[Symbol.isConcatSpreadable] = false;
console.log(show([0].concat(opaque)));
const bytes: any = new Uint8Array([3, 4]);
console.log(show([0].concat(bytes)[1]));
bytes[Symbol.isConcatSpreadable] = true;
console.log(show([0].concat(bytes)));
const text: any = new String("xy");
text[Symbol.isConcatSpreadable] = true;
console.log(show(["w"].concat(text)));
console.log(show([0].concat(new Proxy([5, 6], {}) as any)));

class Stack extends Array<number> {
  get [Symbol.isConcatSpreadable](): boolean {
    return false;
  }
}
console.log(show([0].concat(Stack.of(1, 2) as any).length));
console.log(show(Array.prototype.concat.call(5 as any, 6, [7]).map(value => Number(value))));
console.log(show(Array.prototype.concat.apply([1], [[2], 3, "four"] as any)));
console.log(show(Array.prototype.slice.call("abc")), show(Array.prototype.slice.call(12 as any)), show(Array.prototype.map.call("de", (c: string) => c + c)));

const grown: number[] = [];
let all: number[] = [];
for (let turn = 0; turn < 6; turn++) {
  grown.push(turn);
  all = all.concat(grown, turn % 2 ? turn : [turn * 10]);
}
console.log(show(all), total(all));
