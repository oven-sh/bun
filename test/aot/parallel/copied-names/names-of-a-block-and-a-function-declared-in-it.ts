function outer(list: number[]): string { const out: string[] = []; for (const item of list) { const doubled = item * 2; out.push(show()); function show(): string { return item + ":" + doubled; } } return out.join(); }
console.log(outer([1, 2, 3]));
