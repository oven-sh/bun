const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function store(list: number[], to: number): string { list.length = to >>> 0; return list.length + ":" + Object.keys(list).join(); }
const sparse: number[] = []; sparse[1000000] = 1; sparse[5] = 2; sparse[2] = 3;
console.log(store(sparse, 1000001), store(sparse, numbers[7]!), store(sparse, numbers[3]!), store(sparse, numbers[3]!), store(sparse, numbers[0]!));
