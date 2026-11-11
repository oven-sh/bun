function make(i: number): number[] { return [i + 0.5, i / 4, 2.5, i - 0.25]; }
function whole(i: number): number[] { return [i + 3, i, i + 2]; }
for (const born of [make, whole]) {
    const list = born(2);
    const [first, second, ...others] = list;
    console.log(first, second, others.join("|"), [...list, ...born(3)].join(), list.concat(born(1), [9]).join(), list.slice(1).join(), list.map(x => x * 2).join(), list.filter(x => x > 1).join());
    console.log([...list].sort((a, b) => a - b).join(), [...list].reverse().join(), list.reduce((a, b) => a + b, 0), Math.max(...list), list.indexOf(2.5), list.includes(2), list.at(-1), list.join("/"));
    console.log(Array.isArray(list), Array.from(list).join(), new Float64Array(list).join(), new Set(list).size, Object.entries(list).join(";"), list.toString(), JSON.stringify({ list }));
    let sum = 0; for (const x of list) sum += x; for (const key in list) sum += Number(key); console.log(sum, list.splice(1, 1).join(), list.join(), list.shift(), list.pop(), list.unshift(0.75), list.join());
    console.log(structuredClone(born(5)).join(), list.fill(1.5).join(), list.copyWithin(0, 1).join(), born(1).flat().join(), born(1).with(0, 8.5).join(), born(1).toSorted().join());
}
