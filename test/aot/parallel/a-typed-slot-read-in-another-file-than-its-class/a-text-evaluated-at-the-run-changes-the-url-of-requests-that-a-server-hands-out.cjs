const http = require("node:http");
const requests = Number(process.argv[2] ?? 400), half = requests >> 1, hide = value => [value][JSON.parse("0")];
function read(one) { return one.url; }
const looks = hide(read), name = hide("url");
const tell = value => value === undefined ? -1 : value === null ? -2 : typeof value === "number" ? value : typeof value === "string" ? value.length + 1000 : typeof value === "object" ? 50 : -7;
const change = (0, eval)(`(function (one, kind) {
    if (kind === 0) one.url = 5; else if (kind === 1) one.url = undefined; else if (kind === 2) delete one.url; else if (kind === 3) Object.defineProperty(one, "url", { get() { return 88; }, configurable: true });
    else if (kind === 4) one.url = { a: 1 }; else if (kind === 5) one.url = "another text";
})`);
let sum = 0, wrong = 0, seen = 0;
const server = http.createServer((request, response) => {
    const at = seen++;
    for (let turn = 0; turn < 60; turn++) {
        if (turn === 30 && at >= half) change(request, at % 7);
        const value = looks(request);
        sum += tell(value);
        if (Reflect.get(request, name) !== value) wrong++;
    }
    response.end("ok");
});
server.listen(0, async () => {
    const port = server.address().port;
    for (let at = 0; at < requests; at++) await (await fetch("http://127.0.0.1:" + port + "/p" + "a".repeat(at % 5))).text();
    server.close();
    console.log("SAID", sum, wrong);
});
