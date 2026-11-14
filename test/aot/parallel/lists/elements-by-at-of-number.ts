// at() of a number in a program that holds no list: a TypeError, as of any name that a number does not have.
function call(n: number, k: number): unknown { return (n as any).at(k); }
for (let i = 0; i < 3; i++) { try { console.log(call(process.argv.length, i)); } catch (e) { console.log((e as Error).constructor.name); } }
