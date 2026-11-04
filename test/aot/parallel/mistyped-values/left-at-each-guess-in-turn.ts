// What is read behind a guess that fails is what the function held in front of it: more values than registers take, of every form, with each guess failing in turn.
function openTheWorld(): unknown { return eval("1"); }
type Host = { a: number; b: number; s: string; log: (x: number) => void };
let seen = 0;
function make(kind: number): Host {
  const host: any = { a: 1, b: 2.5, s: "s", log: (x: number) => { seen += x; } };
  // Each kind breaks one guess.
  if (kind === 1) host.a = "one";
  if (kind === 2) host.b = "two";
  if (kind === 3) host.s = 3;
  if (kind === 4) host.log = function (x: any) { seen += 1000; };
  if (kind === 5) delete host.a;
  if (kind === 6) delete host.b;
  return host;
}
export function many(first: Host, second: Host, third: Host, n: number, flag: boolean, text: string) {
  let total = 0;
  let half = 0.5;
  let count = n | 0;
  let label = text + "!";
  const literal = { x: n, y: half };
  const list = [n, n + 1, n + 2];
  const get = () => total + count;
  const put = (v: number) => { total += v; };
  function named() { return label + count; }
  let missing: number | undefined = undefined;
  let nothing: null | Host = null;
  const big = n * 1e15;
  const negative = -0 * (n + 1);

  first.log(first.a + 1); total += first.b; half += first.a;
  label += first.s; count += first.a | 0;
  second.log(second.a + 2); total += second.b; half += second.a; literal.x += 1;
  label += second.s; count += second.a | 0; list[1] = count;
  if (flag) { missing = count; nothing = second; }
  third.log(third.a + 3); total += third.b; half += third.a; literal.y += half;
  label += third.s; count += third.a | 0; put(count);

  return [total, half, count, label, literal.x, literal.y, list.join(), get(), named(), String(missing), nothing === second, big, Object.is(negative, -0), flag, text, n].join(" | ");
}
openTheWorld();
(globalThis as any).many = many;
for (let a = 0; a < 7; a++) for (let b = 0; b < 7; b++) for (let c = 0; c < 7; c++) {
  if (a && b && c && (a + b + c) % 5) continue;
  console.log(a, b, c, many(make(a), make(b), make(c), a * 10 + b, (a + c) % 2 === 0, "t" + c), seen);
}
