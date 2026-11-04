// arrives undefined written the record
type Inner = { x: number; y: string | null };
type A = { id: number; name: string; tags: string[]; inner: Inner };
type B = { ok: boolean; total: number };
let said = "";
let sunk = 0;
let deeds = 0;
const log: string[] = [];
function spin(n: number): number { let t = 0; for (let i = 0; i < (n & 3); i++) t += i; return t; }
function makeA(n: number): A { const t = spin(n); return { id: n + t * 0, name: "n" + n, tags: ["a", "b" + n], inner: { x: n, y: n & 1 ? "odd" : null } }; }
function makeB(n: number): B { const t = spin(n); return { ok: n > 1, total: n + t * 0 }; }
function head(status: number, o: { kind: string; length: number }) { sunk += status + o.length; }
function end(text: string) { said += text + "\n"; }
function send(status: number, value: A): void { const body = JSON.stringify(value) ?? "nothing"; head(status, { kind: "application/json", length: body.length }); end(body); }
function pick(k: number): A { const a = makeA(k); const t = spin(k); return (k % 3 === 2 + t * 0 ? undefined : a) as A; }
function shape(k: number): unknown { send(200, pick(k)); }

async function main() {
  for (let k = 0; k < 14; k++) {
    try {
      const answer = await shape(k);
      if (answer !== undefined) said += "answer " + String(answer) + "\n";
    } catch (error) {
      said += "threw " + (error as Error).name + "\n";
    }
  }
  console.log(said + sunk + " " + deeds + " " + log.join(","));
}
await main();
