// STATISTIC: GeneratorsDrivenByHelpers >= 3
// __awaiter applies the generator function that it is given and steps what that answers: nobody looks above those generators.
function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}
// This one keeps what it is given: its generators are seen.
const kept = [];
function keeping(thisArg, generator) {
    kept.push(generator);
    const made = generator.apply(thisArg, []);
    kept.push(made);
    return made.next().value;
}
// This one hands the generator on.
function handing(generator, show) {
    const made = generator.apply(undefined, []);
    show(made);
    return [...made].join();
}
class Service {
    constructor(name) { this.name = name; this.calls = 0; }
    load(id) {
        return __awaiter(this, arguments, undefined, function* (number = id) {
            this.calls++;
            const first = yield wait(number);
            try {
                yield fail(number);
            } catch (error) {
                return `${this.name}:${first}:${error.message}`;
            } finally {
                this.calls += 10;
            }
        });
    }
    sum(values) {
        return __awaiter(this, void 0, void 0, function* () {
            let total = 0;
            for (const value of values)
                total += yield value;
            return total + this.calls;
        });
    }
    throws() {
        return __awaiter(this, void 0, void 0, function* () {
            yield 1;
            throw new RangeError(this.name);
        });
    }
}
function wait(value) { return Promise.resolve(value * 2); }
function fail(value) { return value % 2 ? Promise.reject(new Error("odd " + value)) : Promise.resolve(value); }
const service = new Service("s");
for (let i = 0; i < 6; i++)
    console.log(i, await service.load(i), service.calls);
console.log(await service.sum([1, Promise.resolve(2), { then(resolve) { resolve(30); } }, 4]), await Promise.all([service.sum([]), service.sum([5]), service.load(9)]));
try {
    await service.throws();
} catch (error) {
    console.log(error.name, error.message);
}
const outside = yieldsItself => __awaiter(null, void 0, void 0, function* () {
    const inner = yield __awaiter({ deep: yieldsItself }, void 0, void 0, function* () { return (yield this.deep) + 1; });
    return inner * 2;
});
console.log(await outside(20), await outside(Promise.resolve(1)));
console.log(keeping({ n: 4 }, function* () { yield this.n; yield 2; }), Object.getPrototypeOf(kept[1]) === kept[0].prototype, kept[1] instanceof kept[0], [...kept[1]].join());
const seen = [];
console.log(handing(function* () { yield 1; yield 2; }, made => seen.push(Object.getPrototypeOf(made))), Object.keys(seen[0]).length, Object.getPrototypeOf(seen[0]) === Object.getPrototypeOf(function* () {}).prototype);
let named;
console.log(await __awaiter(1, [2, 3], Promise, function* own(a, b) { "use strict"; named = own; return [this, a, b, typeof own.prototype, yield a].join(); }), typeof named);
class Mine extends Promise {}
const mine = __awaiter(undefined, void 0, Mine, function* () { return yield Mine.resolve(8); });
console.log(mine instanceof Mine, await mine);
const order = [];
await Promise.all([1, 2, 3].map(n => __awaiter(undefined, void 0, void 0, function* () { order.push("a" + n); yield; order.push("b" + n); yield wait(n); order.push("c" + n); })));
console.log(order.join());
