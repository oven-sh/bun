function Lantern() { this.kind = new.target === Lantern ? "lantern" : new.target.name; }
function Candle() {}
const makers = [Lantern, Candle];
const pick = makers[JSON.parse("0")];
console.log(Reflect.construct(pick, [], makers[JSON.parse("1")]).kind, new pick().kind);
