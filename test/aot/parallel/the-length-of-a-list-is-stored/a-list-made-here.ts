const numbers: number[] = JSON.parse("[0,1,2,3,4,5,8,100,70000]");
function fresh(to: number): string { const list = [1, 2, 3, 4]; list.length = to >>> 0; return list.length + ":" + list.join() + ":" + list[2]; }
function freshTwice(): string { const list = [1, 2, 3, 4]; list.length = 2; const first = list.length; list.length = 4; return first + ":" + list.length + ":" + (3 in list) + ":" + list[3]; }
function literalOfNone(to: number): number { const list: number[] = []; list.length = to >>> 0; return list.length; }
function pushedThenCut(to: number): string { const list: number[] = []; list.push(1); list.push(2); list.push(3); list.length = to >>> 0; list.push(9); return list.join() + ":" + list.length; }
console.log(fresh(numbers[2]!), fresh(numbers[4]!), fresh(numbers[6]!), freshTwice(), literalOfNone(numbers[0]!), literalOfNone(numbers[3]!), pushedThenCut(numbers[1]!), pushedThenCut(numbers[3]!));
