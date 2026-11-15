// Where one of the callees is not in sight, or a binding is stored again, the place stays as written; the answers are the same.
class A { k = 1; }
class B { k = 2; }
let Stored = B;
const Unseen = new Function("return class { k = 32; }")();
const unseenFunction = new Function("x", "return x + 1000");
function near(x) { return x + 1; }

const log = [];
for (let i = 0; i < 8; i++) {
    const C = i & 1 ? A : Unseen;
    log.push(new C().k);
    const S = i & 1 ? A : Stored;
    log.push(new S().k);
    if (i === 4)
        Stored = Unseen;
    const f = i & 1 ? near : unseenFunction;
    log.push(f(i));
    const R = i & 1 ? A : B;
    log.push(Reflect.construct(R, []).k, Reflect.construct(R, [], i & 2 ? A : B) instanceof A);
}
console.log(log.join());
