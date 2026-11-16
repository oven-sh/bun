const { encodingOf, hostOf, Listed } = require("./lib-reads.cjs");
const turns = Number(process.argv[2] ?? 60000), half = turns >> 1, hide = value => [value][JSON.parse("0")];
const decoders = hide([new TextDecoder(), new TextDecoder("utf-16le"), new TextDecoder(), new TextDecoder("latin1"), new Listed(2)]);
const places = hide([new URL("http://one.example:81/a"), new URL("http://two.example/b"), new URL("http://three.example/c"), new Listed(3)]);
const change = (0, eval)(`(function (decoders, places) {
    Object.defineProperty(decoders[0], "encoding", { value: "own", configurable: true });
    Object.setPrototypeOf(decoders[1], Object.create(TextDecoder.prototype, { encoding: { get() { return "laid"; }, configurable: true } }));
    Object.setPrototypeOf(decoders[2], null);
    Object.defineProperty(places[0], "host", { get() { return "own getter"; }, configurable: true });
    places[1].host = "moved.example";
    delete places[3].host;
})`);
const weigh = value => typeof value === "string" ? value.length * 7 + (value.charCodeAt(0) || 0) : value === undefined ? -1 : -3;
let sum = 0, wrong = 0;
for (let turn = 0; turn < turns; turn++) {
    if (turn === half) change(decoders, places);
    const decoder = decoders[turn % decoders.length], place = places[turn % places.length], encoding = encodingOf(decoder), host = hostOf(place);
    sum += weigh(encoding) + 3 * weigh(host);
    if ((turn % 499 === 0 || (turn >= half && turn < half + 96)) && (Reflect.get(decoder, "encoding") !== encoding || Reflect.get(place, "host") !== host)) wrong++;
}
console.log("SAID", sum, wrong);
