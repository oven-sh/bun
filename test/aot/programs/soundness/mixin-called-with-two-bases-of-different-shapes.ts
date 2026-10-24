type Constructor<T = {}> = new (...list: any[]) => T;
class P { x: number = 1; kind(): string { return "P"; } }
class Q { y: string = "q"; z: number = 2.5; kind(): string { return "Q"; } }
function Tagged<T extends Constructor<{ kind(): string }>>(Base: T) {
  return class extends Base {
    tag: string = "tag of " + this.kind();
    kind(): string { return "tagged " + super.kind(); }
  };
}
const TP = Tagged(P), TQ = Tagged(Q);
const p = new TP(), q = new TQ();
console.log(p.tag, p.kind(), p.x, Object.keys(p).join(), p instanceof P, (p as any) instanceof Q);
console.log(q.tag, q.kind(), q.y, q.z, Object.keys(q).join(), q instanceof Q);
function read(o: { tag: string }): number { return o.tag.length; }
console.log(read(p), read(q));
