let list: unknown[] | undefined;
function* looks(): Generator<string> { yield "first " + typeof list; yield "second " + typeof list; }
list = ["head", ...looks()];
console.log(list.join());
function* grows(limit: number): Generator<number[]> { for (let i = 0; i < limit; i++) yield new Array(i).fill(i); }
console.log(JSON.stringify([...grows(4)]));
