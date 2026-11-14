// What is constructed is one of two, three or four classes, in a loop and outside one.
class A { k = 1; }
class B { k = 2; }
class D { k = 4; constructor(more) { this.more = more; } }
class E extends D { k = 8; constructor(more) { super(more + 1); } }

function pickOf(count, i) {
    const place = i % count;
    return place === 0 ? A : place === 1 ? B : place === 2 ? D : E;
}

for (const count of [2, 3, 4]) {
    let sum = 0;
    const names = [];
    for (let i = 0; i < 9; i++) {
        const place = i % count;
        const C = place === 0 ? A : place === 1 ? B : place === 2 ? D : E;
        const o = new C(i);
        sum += o.k + (o.more || 0);
        names.push(o.constructor.name, Object.keys(o).join("+"), o instanceof D);
    }
    console.log(count, sum, names.join());
}

const Once = Date.now() > 0 ? A : B;
console.log(new Once().k, new (pickOf(4, 3))(5).more);
