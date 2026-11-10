function pass(x: unknown): unknown { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return x; }
function main(): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const promise: any = Promise.resolve(1); const held: unknown = JSON.parse("true") ? promise : 1;
  const same: any = Promise.resolve(held); promise.then = (): string => "own"; return `${String(same.then(pass))}`; }
console.log(main());
export {};
