const long: number[] = [];
for (let i = 0; i < 3000; i++) long.push(i & 15);
const own: unknown[] = [...long];
console.log(own.length, own[7], typeof own[7]);
(own as unknown[]).push("text");
console.log(own.length, own[7], own[3000]);
