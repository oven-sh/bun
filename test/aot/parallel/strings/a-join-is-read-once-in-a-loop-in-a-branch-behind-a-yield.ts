const unseen = <V,>(value: V): V => [value][JSON.parse("0")] as V;
function labels(a: number, most: number): string { const head = a + ":"; let last = ""; for (let i = 0; i < most; i++) last = (head as string) + i; return last; }
function inside(a: number, most: number): string { let last = ""; for (let i = 0; i < most; i++) { const head = a + ":"; if (i & 1) last = head + i; } return last; }
function nested(a: number, most: number): string { let all = ""; for (let i = 0; i < most; i++) { const head = a + i + ":"; for (let j = 0; j < 2; j++) all += (head as string) + j + ","; } return all; }
function eitherWay(a: number, on: boolean): string { const head = a + ":" + on; let work = 0; for (let k = 0; k < 2; k++) work = (work + k) | 0; return on ? head + "/yes" + work : head + "/no"; }
function caught(a: number, list: number[] | null): string { const head = a + "#"; try { return head + list!.length; } catch { return head + "none"; } }
function* steps(a: number, most: number): Generator<string> { for (let i = 0; i < most; i++) { const head = a + i + ":"; yield "first" + i; a += 10; yield head + a; } }
function* once(a: number): Generator<string> { const head = a + ":"; yield "first"; a += 10; yield head + a; }
async function waits(a: number): Promise<string> { const head = a + ":"; a += await Promise.resolve(10); return head + a; }
for (const a of [unseen(1), unseen(2.5), unseen(-0), unseen(1e21)]) {
  let walked = "";
  for (const step of steps(a, 3)) walked += step + " ";
  for (const step of once(a)) walked += step + " ";
  console.log(labels(a, 3), inside(a, 4), nested(a, 2), eitherWay(a, true), eitherWay(a, false), caught(a, [1, 2]), caught(a, null), walked, [...steps(a, 2)].join("|"), await waits(a));
}
