class Money extends Intl.NumberFormat {}
Reflect.set(Money.prototype.__proto__, JSON.parse("\"format\"") + "ToParts", function () { return "patched"; });
console.log(String(new Intl.NumberFormat("en-US").formatToParts(1)));
