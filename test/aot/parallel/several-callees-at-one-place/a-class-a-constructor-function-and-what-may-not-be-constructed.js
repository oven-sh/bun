// A class beside a constructor function; an arrow and a method among what `new` is given; a class among what is called.
class A { k = 1; }
function Old(k) { this.k = k === undefined ? 16 : k; }
Old.prototype.twice = function () { return this.k * 2; };
function Answers() { return { k: 64 }; }
const arrow = () => ({ k: 128 });
const holder = { method() { return { k: 256 }; } };

function attempt(work) {
    try {
        return work();
    } catch (error) {
        return error.constructor.name;
    }
}

const log = [];
for (let i = 0; i < 6; i++) {
    const C = i & 1 ? A : Old;
    const o = new C();
    log.push(o.k, typeof o.twice);
    const R = i & 1 ? Answers : Old;
    log.push(new R(i).k);
    const N = i & 1 ? arrow : A;
    log.push(attempt(() => new N().k));
    const M = i & 1 ? holder.method : Old;
    log.push(attempt(() => new M(3).k));
    const called = i & 1 ? A : arrow;
    log.push(attempt(() => called().k));
}
console.log(log.join());
