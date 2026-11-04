// the read stands in the head of the switch; a case falls through into the next, and the default stands in the middle
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Token { kind: number; text: string; constructor(kind: number, text: string) { this.kind = kind; this.text = text; } }
const log: string[] = [];
function classify(token: Token, depth: number): string {
    log.push("in");
    let out = "d" + depth;
    switch (token.kind) {
    case 1: out += " one";
    case 2: out += " two"; break;
    default: out += " other";
    case 3: out += " three " + token.text; break;
    case 4: return out + " four";
    }
    log.push("out");
    return out;
}
const classifyByValue = through(classify);
for (const kind of [1, 2, 3, 4, 5, "1", undefined]) console.log(classifyByValue(new Token(kind as any, "t"), 1), "|", classifyByValue({ kind, text: "l" } as any, 2));
console.log(log.length);
