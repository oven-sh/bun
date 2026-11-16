// Every way to leave a try, a catch and a finally: a labelled block around a loop of two turns around
// `try { A } catch (e) { B } finally { C }`, also without the catch and without the finally, with every triple of fourteen atoms.
// Plain functions take the triples without a suspension, generators and async functions those with one. A generator is driven by
// next() alone, by return() at its first yield and by throw() at its first yield.
// Every place logs its number and adds it to a sum, which the finally and the end log.
import type { Cell } from "./cells";

const at = (n: number) => `log(${n}); sum += ${n};`;
const atoms: Record<string, (n: number, head: string) => string> = {
  "-": n => at(n),
  ret: n => `${at(n)} return ${n};`,
  thr: n => `${at(n)} throw "e${n}";`,
  brk: n => `${at(n)} break;`,
  cnt: n => `${at(n)} continue;`,
  out: n => `${at(n)} break outer;`,
  "ret|brk": n => `try { ${at(n)} return ${n}; } finally { ${at(n + 1)} break; }`,
  "thr|cnt": n => `try { ${at(n)} throw "e${n}"; } finally { ${at(n + 1)} continue; }`,
  "thr|ret": n => `try { ${at(n)} throw "e${n}"; } finally { ${at(n + 1)} return ${n + 1}; }`,
  "thr,": n => `try { ${at(n)} throw "e${n}"; } catch (inner) { log("i" + inner); sum += ${n + 1}; }`,
  "thr?": n => `${at(n)} if (turn === 1) throw "e${n}";`,
  "ret?": n => `${at(n)} if (turn === 1) return ${n};`,
  call: n => `${at(n)} thrower(turn);`,
  sus: (n, head) => (head.includes("*") ? `${at(n)} log("got " + (yield ${n}));` : `${at(n)} await ${n}; log("on");`),
};

function bodyOf(form: string, a: string, b: string, c: string, head: string) {
  const caught = form.includes("c") ? ` catch (e) { log("c" + e); ${atoms[b](20, head)} }` : "";
  const last = form.includes("f") ? ` finally { log("s" + sum); ${atoms[c](30, head)} }` : "";
  return `let sum = 0, turn = 0; outer: { for (turn = 0; turn < 2; turn++) { log("t" + turn); try { ${atoms[a](10, head)} }${caught}${last} log("after"); sum += 1; } log("loop ends"); } log("ends " + sum + " " + turn); return "done";`;
}

export const helpers = `function thrower(turn) { if (turn === 0) throw "thrown by a call"; }
async function drive(make, how) {
  try {
    if (how === "call") return log("=" + (await make()));
    const it = make();
    let step = 0, r = await it.next();
    while (!r.done && step++ < 12) {
      log("y" + r.value);
      r = await (step === 1 && how === "return" ? it.return("R") : step === 1 && how === "throw" ? it.throw("T") : it.next("n" + step));
    }
    log("=" + r.value);
  } catch (e) { log("!" + e); }
}
`;
export const call = `await drive(run, how);`;

export function cells(): Cell[] {
  const names = Object.keys(atoms);
  const heads = {
    plain: "function",
    generator: "function*",
    async: "async function",
    "async generator": "async function*",
  };
  const all: Cell[] = [];
  for (const form of ["tcf", "tf", "tc"])
    for (const a of names)
      for (const b of form.includes("c") ? names : ["-"])
        for (const c of form.includes("f") ? names : ["-"]) {
          const suspends = [a, b, c].includes("sus");
          for (const [kind, head] of Object.entries(heads)) {
            if ((kind === "plain") === suspends) continue;
            for (const drive of head.includes("*") ? ["next", "return", "throw"] : ["call"]) {
              const id = "k" + (all.length + 1);
              all.push({
                id,
                what: `${form} | ${a} . ${form.includes("c") ? b : ""} . ${form.includes("f") ? c : ""} | ${kind} | ${drive}`,
                text: `${head} ${id}() { ${bodyOf(form, a, b, c, head)} }`,
                row: `"${drive}"`,
              });
            }
          }
        }
  return all;
}
