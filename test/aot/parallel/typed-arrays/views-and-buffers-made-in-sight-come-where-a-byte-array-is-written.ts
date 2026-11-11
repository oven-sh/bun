// STATISTIC: TypedArrayLengthGuardsAllowingSubclasses = 4
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: where the length is believed by the note the weaker test is asked again
// The callers of these functions are in sight and hand over what `new Uint8Array(n)` and `Buffer.alloc(n)` make: what is proven of the parameter is the two classes. They are one kind of view, and the second is
// the class below the first: the loop has the front that it has where Uint8Array alone is known. A third class beside them, and two kinds of views, are as before.
function total(a: Uint8Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s; }
function written(a: Uint8Array): number { for (let i = 0; i < a.length; i++) a[i] = a[i]! + i; return a[a.length - 1] ?? -1; }
function altered(a: Uint8Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! + a.length; return s; }
function three(a: Uint8Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s; }
function kinds(a: Uint8Array | Int8Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]!; return s; }
class Short extends Uint8Array { get length(): number { return 1; } }
for (let turn = 0; turn < 3; turn++) {
  console.log(total(new Uint8Array(3).fill(2)), total(Buffer.alloc(2, 5)), total(Buffer.alloc(0)), total(new Uint8Array(0)));
  console.log(written(new Uint8Array(3).fill(1)), written(Buffer.alloc(4, 250)));
  const own = Buffer.alloc(2, 5), ownOfView = new Uint8Array(2).fill(5), lowered = Buffer.alloc(2, 7), raised = new Uint8Array(3).fill(7), named = Buffer.alloc(2, 9);
  Object.defineProperty(own, "length", { value: 1 });
  Object.defineProperty(ownOfView, "length", { value: 1 });
  Object.setPrototypeOf(lowered, Uint8Array.prototype);
  Object.setPrototypeOf(raised, Buffer.prototype);
  (named as any).extra = 1;
  console.log(altered(own), altered(ownOfView), altered(lowered), altered(raised), altered(named));
  console.log(three(new Uint8Array(3).fill(2)), three(Buffer.alloc(2, 4)), three(new Short(2).fill(6)));
  console.log(kinds(new Uint8Array(3).fill(200)), kinds(new Int8Array(3).fill(-2)));
}
