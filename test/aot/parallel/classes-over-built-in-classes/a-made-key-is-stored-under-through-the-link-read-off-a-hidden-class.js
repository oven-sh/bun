class Money extends Intl.NumberFormat {}
const hidden = [Money, 1][JSON.parse("0")];
hidden.__proto__[JSON.parse("\"supported\"") + "LocalesOf"] = function () { return "patched"; };
console.log(String(Intl.NumberFormat.supportedLocalesOf("en-US")));
