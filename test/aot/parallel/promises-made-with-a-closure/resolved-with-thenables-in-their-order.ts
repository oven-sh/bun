const out: string[] = [];
let order = 0;
for (let i = 0; i < 4; i++) {
  const thenable = { then(done: (v: string) => void) { out.push("then read " + i + " at " + order++); done("from a thenable " + i); } };
  new Promise<string>(resolve => { resolve(thenable as any); out.push("behind resolve " + i + " at " + order++); }).then(v => out.push(v + " at " + order++));
  new Promise<number>(resolve => resolve(Promise.resolve(i * 10))).then(v => out.push("adopted " + v + " at " + order++));
  new Promise<number>(resolve => resolve(new Promise<number>(inner => inner(i * 100)))).then(v => out.push("nested " + v + " at " + order++));
  const throwing = { get then() { throw new EvalError("then getter " + i); } };
  new Promise(resolve => resolve(throwing)).catch(e => out.push(e.name + " " + e.message + " at " + order++));
}
for (let k = 0; k < 8; k++) await null; console.log(out.join("\n"));
