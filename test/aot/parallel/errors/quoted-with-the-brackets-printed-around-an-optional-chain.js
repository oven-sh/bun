// `(o?.a).b` ends the chain at the bracket, so Bun's transpiler prints the brackets, also where it prints `o?.a` in place of a name. An error quotes them, and the
// column of its frame counts them. Each row reads or calls a member of its own, so no two share code.
const o = { one: 1, a: { b: {}, none: null, two: 2, three: 3, four: 4, five: 5 }, none: null, nothing() { return null; }, make() { return {}; } };
const inThisFile = /quoted-with-the-brackets-printed-around/;
function tell(label, run) {
  try {
    run(o, "key", "none");
    console.log(label + ": nothing thrown");
  } catch (error) {
    const frame = String(error.stack).split("\n").find(line => inThisFile.test(line));
    console.log(label + ": " + error.message + " at " + /:(\d+:\d+)\)?$/.exec(frame)[1]);
  }
}

// The brackets are written.
tell("chain called", o => (o?.one)());
tell("chain called with an argument", o => (o?.a.b)(1));
tell("member called", o => (o?.a).m1());
tell("member called with arguments", o => (o?.a).m2(1, 2));
tell("member of a longer chain called", o => (o?.a.b).m3(1));
tell("member of a member called", o => (o?.a).b.m4(1));
tell("element called", (o, k) => (o?.a)[k](1));
tell("member called with a list", (o, k, ...rest) => (o?.a).m5(...rest));
tell("member called through call", o => (o?.a).m6.call(null, 1));
tell("member constructed", o => new (o?.a).M7());
tell("member constructed without a list", o => new (o?.a).M8);
tell("member read", o => (o?.none).x1);
tell("element read", (o, k) => (o?.none)[k]);
tell("member of a longer chain read", o => (o?.a.none).x2.y);
tell("member stored", o => { (o?.none).x3 = 1; });
tell("member deleted", o => delete (o?.none).x4);
tell("member updated", o => (o?.none).x5++);
tell("member tested for a key", (o, k) => k in (o?.a).x6);
tell("member tested for an instance", o => o instanceof (o?.a).b);
tell("member walked", o => { for (const value of (o?.a).x8) return value; });
tell("member spread into a list", o => [...(o?.a).two]);
tell("member spread into arguments", o => Math.max(...(o?.a).three));
tell("member spread into an object", o => ({ ...(o?.none).x11 }));
tell("member read in an argument", o => o.make((o?.none).x12));

// No brackets are printed where the chain goes on.
tell("chain that goes on called", o => o?.a.m13(1));
tell("chain that goes on read", o => o?.none.x14);
tell("chain that goes on behind brackets called", o => (o?.a)?.m15());

// The chain is printed in place of a name.
tell("name, member called", o => { const r = o?.a; return r.m16(1); });
tell("name, member read", o => { const r = o?.none; return r.x17; });
tell("name, member constructed", o => { const r = o?.a; return new r.M18(); });
tell("name, element read", (o, k) => { const r = o?.none; return r[k + 19]; });
tell("name, longer chain", o => { const r = o?.a.none; return r.x20; });
tell("name, call in the chain", o => { const r = o?.nothing(); return r.x21; });
tell("name, call in the chain, member called", o => { const r = o?.make(); return r.m22(1); });
tell("name, element in the chain", (o, k, n) => { const r = o?.[n]; return r.x23; });
tell("name, two names", o => { const first = o?.a; const second = first; return second.m24(1); });
tell("name in brackets", o => { const r = o?.none; return (r).x25; });
tell("name, chain in brackets", o => { const r = (o?.none); return r.x26; });
tell("name, member tested for a key", o => { const r = o?.a; return "key" in r.x27; });
tell("name, member spread into a list", o => { const r = o?.a; return [...r.four]; });
tell("name, member spread into arguments", o => { const r = o?.a; return Math.max(...r.five); });
tell("name, member spread into an object", o => { const r = o?.none; return { ...r.x31 }; });
tell("name, chain goes on", o => { const r = o?.a; return r?.m32(1); });
tell("name tested for a key", o => { const r = o?.none; return "key" in r; });

// One operand of an operator is printed alone.
tell("last of a comma", o => (0, o?.none).x33);
tell("right of and", o => (1 && o?.none).x34);
tell("branch of a condition", o => (1 ? o?.none : 0).x35);
tell("right of ??", o => (null ?? o?.none).x36);
tell("last of a comma, member called", o => (0, o?.a).m37(1));
