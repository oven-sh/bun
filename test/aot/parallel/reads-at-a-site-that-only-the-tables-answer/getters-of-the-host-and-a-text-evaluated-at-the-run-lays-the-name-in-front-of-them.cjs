const { encodingOf, hostOf, Listed } = require("./lib-reads.cjs");
const { StringDecoder } = require("node:string_decoder");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
const all = hide([new TextDecoder(), new TextDecoder("utf-16le"), new StringDecoder("utf8"), new StringDecoder("latin1"), new URL("http://one.example:81/a"), new URL("http://two.example/b"), new TextDecoder(), new URL("http://three.example/c"), new Listed(2), { encoding: "plain", host: "there" }]);
const change = (0, eval)(`(function (all) {
    Object.defineProperty(all[0], "encoding", { value: "own", configurable: true });
    Object.setPrototypeOf(all[1], Object.create(TextDecoder.prototype, { encoding: { get() { return "laid"; }, configurable: true } }));
    Object.setPrototypeOf(all[2], { encoding: "another prototype" });
    Object.defineProperty(all[4], "host", { get() { return "own getter"; }, configurable: true });
    all[5].host = "moved.example";
    Object.setPrototypeOf(all[7], null);
    all[6].host = "added";
})`);
const weigh = value => typeof value === "string" ? value.length * 7 + (value.charCodeAt(0) || 0) : value === undefined ? -1 : -3;
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) change(all);
    const one = all[turn % all.length], encoding = encodingOf(one), host = hostOf(one);
    sum += weigh(encoding) + 3 * weigh(host);
    if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && (Reflect.get(one, "encoding") !== encoding || Reflect.get(one, "host") !== host)) wrong++;
}
console.log("SAID", sum, wrong);
