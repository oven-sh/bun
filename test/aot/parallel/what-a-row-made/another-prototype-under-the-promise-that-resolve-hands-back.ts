function pass(x: unknown): unknown { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return x; }
function main(): string { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const promise: any = Promise.resolve(1); Object.setPrototypeOf(promise, Object.create(Promise.prototype, { then: { value: (): string => "above" } }));
  const held: unknown = JSON.parse("true") ? promise : 1; return `${String(Promise.resolve(held).then(pass))}`; }
console.log(main());
export {};
