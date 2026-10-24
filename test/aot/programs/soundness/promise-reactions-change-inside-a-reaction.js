// The reaction passed to then changes inside a reaction, thenables and rejections are followed, and a promise stops being pristine.
function main() {
  const p = Promise.resolve(1);
  let handler = (v) => { handler = (w) => ({ boxed: w }); return "text"; };
  let current = p;
  const seen = [];
  function step(n) {
    if (!n) { console.log(seen.join()); return; }
    current = current.then(handler);
    current.then((v) => { seen.push(typeof v); step(n - 1); });
  }
  step(3);
  const q = Promise.resolve({ then(resolve) { resolve({ from: "thenable" }); } });
  q.then((v) => console.log(typeof v, v.from));
  const r = Promise.reject({ why: "rejected" });
  r.then(null, (e) => { console.log(e.why); throw { why: "thrown again" }; }).catch((e) => console.log(e.why));
  const own = Promise.resolve(5);
  const same = Promise.resolve(own);
  console.log(same === own);
  own.constructor = function Other(executor) { executor(() => {}, () => {}); this.other = true; };
  const different = Promise.resolve(own);
  console.log(different === own);
}
main();
