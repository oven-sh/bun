// three small functions, each called once by the next: wherever the innermost fails, what the two outer ones have done is done once and what they still owe is done
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Part { amount: number; constructor(amount: number) { this.amount = amount; } }
const log: string[] = [];
function inner(part: Part, step: number): number { log.push("inner " + step); return part.amount + step; }
function middle(part: Part, step: number): number { log.push("middle in"); const got = inner(part, step + 1) * 2; log.push("middle out"); return got + step; }
function outer(parts: Part[], step: number): number {
    log.push("outer in");
    let sum = step * 1000;
    sum += middle(parts[0], step);
    log.push("between");
    sum += middle(parts[1], step + 10);
    log.push("outer out");
    return sum;
}
const outerByValue = through(outer);
const good = new Part(1);
const bad: any = { amount: 5 };
for (const parts of [[good, good], [good, bad], [bad, good], [bad, bad]]) { log.length = 0; console.log(outerByValue(parts, 3), log.join()); }
