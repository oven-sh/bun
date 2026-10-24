const source = { first: "1.5".repeat(2), size: [], flag: 100, tag: [7] };
const taker = { first: source.size, size: typeof 7, flag: "été".charCodeAt(3) | 0, tag: [] };
const alias = taker;
function total(list: number[]): number { let sum = 0; for (let index = 0; index < list.length; index++) sum += list[index]; return sum; }
const holder = { text: taker.size + taker, tag: [taker.flag] }; const [first] = holder.tag; console.log(first, total(holder.tag), Math.max(...holder.tag), holder.tag.at(0), holder.tag[0] + 1);
Array.from({ length: 1 }, () => { Object.defineProperty(source, "0~".slice(), { value: alias.flag << 16 }); });
