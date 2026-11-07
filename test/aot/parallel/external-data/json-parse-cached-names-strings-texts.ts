// JSON.parse remembers short names and strings by the bytes of the source. A 16-bit text has one byte for each character, and the same byte for every character outside Latin-1:
// what is remembered from one text may be found again in a text of the other width only where equal bytes are equal characters.
function codes(value: unknown): string {
    const text = JSON.stringify(value);
    let shown = "";
    for (let i = 0; i < text.length; i++) shown += text.charCodeAt(i) < 127 ? text[i] : "<" + text.charCodeAt(i).toString(16) + ">";
    return shown;
}
function widened(text: string): string { return (text + "中").slice(0, -1); }
const texts = [
    '{"ÿ":"ÿÿ","a":"ÿb","list":[{"ÿ":1},{"ÿ":2}]}',
    '{"中":"中文","a":"中b","list":[{"中":1},{"文":2}]}',
    '{"þ":"þþ","a":"þb","list":[{"þ":1},{"ÿ":2}]}',
    '{"name":"Ada","a":"plain","list":[{"name":"Ada"},{"name":"Ada"}]}',
    '{"name":"Ada","a":"plain","list":[{"name":"Ada"},{"name":"中"}],"中":"Ada"}',
    '{"café":"café","a":"café","list":[{"café":"café"}]}',
    '{"cafй":"cafй","a":"cafй","list":[{"cafй":"cafй"}]}',
];
const lines: string[] = [];
for (let round = 0; round < 3; round++) {
    for (const text of texts) {
        lines.push(codes(JSON.parse(text)));
        lines.push(codes(JSON.parse(widened(text))));
    }
    for (const text of texts.slice().reverse()) lines.push(codes(JSON.parse(widened(text))) + codes(JSON.parse(text)));
}
console.log(lines.join("\n"));
