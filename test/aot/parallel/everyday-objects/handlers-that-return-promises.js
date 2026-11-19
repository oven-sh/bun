// Handlers that return promises of promises, thenables and objects with a then of their own
const thenable = value => ({ then: done => done(value) });
async function run(n) {
  const out = [];
  out.push(await Promise.resolve(n).then(x => Promise.resolve(Promise.resolve(x + 1))));
  out.push(await Promise.resolve(n).then(thenable));
  out.push((await Promise.resolve(n).then(x => ({ then: x }))).then);
  out.push(await Promise.reject(n).catch(x => thenable(thenable(x * 2))));
  const bare = Promise.resolve(n * 3);
  bare.then = undefined;
  const same = await Promise.resolve(1).then(() => bare);
  out.push(same === bare, await Promise.resolve().finally(() => bare).then(x => String(x)));
  console.log(out.join());
}
run(1).then(() => run(20)).then(() => run(-1));
