const out: string[] = [];
class Below<T> extends Promise<T> { tag = "below"; static get [Symbol.species]() { return Promise; } }
function Other() { } Other.prototype = { marked: true };
for (let i = 0; i < 3; i++) {
  const b = new Below<number>(resolve => resolve(i)); out.push([b instanceof Below, b instanceof Promise, b.tag, b.then(() => 0) instanceof Below].join(" "));
  const r = Reflect.construct(Promise, [(resolve: (v: number) => void) => resolve(i)], Other); out.push([r instanceof Promise, (r as any).marked, Object.prototype.toString.call(r)].join(" "));
  const p = new Promise<number>(resolve => resolve(i)); out.push([p instanceof Promise, p.constructor === Promise, Object.getPrototypeOf(p) === Promise.prototype, Object.prototype.toString.call(p), Object.keys(p).length].join(" "));
}
console.log(out.join("\n"));
