function Ring() { this.size = 0; }
Ring.prototype.first = function () { return this['1.5'] ? this['1.5']() : 'none'; };
const half = JSON.parse('1.5');
const byReflect = new Ring(); Reflect.set(byReflect, half, () => 'reflect');
const byDefinition = new Ring(); Object.defineProperty(byDefinition, half, { value: () => 'definition' });
const byAssign = new Ring(); Object.assign(byAssign, { [half]: () => 'assign' });
const bySpread = { first: Ring.prototype.first, ...{ [half]: () => 'spread' } };
const target = new Ring(); new Proxy(target, {})[half] = () => 'proxy';
const plain = new Ring(); plain[half] = () => 'store';
console.log([byReflect, byDefinition, byAssign, bySpread, target, plain, new Ring()].map((ring) => ring.first()).join());
