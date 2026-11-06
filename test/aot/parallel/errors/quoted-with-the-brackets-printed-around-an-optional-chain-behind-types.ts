// `(o?.a as T).b` and `(o?.a)!.b` are printed `(o?.a).b`: the syntax of a type between an optional chain and what reads from it changes nothing of the brackets that
// Bun's transpiler prints, also where it prints the chain in place of a name. Where written brackets around the type of such a name stay, they are those brackets.
// Each row reads or calls a member of its own, so no two share code.
const o: any = { one: 1, a: { none: null, two: 2, three: 3 }, none: null };
const inThisFile = /quoted-with-the-brackets-printed-around/;
function tell(label: string, run: (o: any, k: string) => unknown) {
  try {
    run(o, "key");
    console.log(label + ": nothing thrown");
  } catch (error: any) {
    const frame = String(error.stack).split("\n").find(line => inThisFile.test(line));
    console.log(label + ": " + error.message + " at " + /:(\d+:\d+)\)?$/.exec(frame!)![1]);
  }
}

// The type stands between a written chain and what reads from it.
tell("asserted chain called", o => (o?.one as any)(1));
tell("chain behind ! called", o => (o?.one)!(2));
tell("asserted chain, member called", o => (o?.a as any).m1(1));
tell("chain behind !, member called", o => (o?.a)!.m2(1));
tell("chain that goes on behind !, member called", o => o?.a!.m3(1));
tell("asserted chain, member read", o => (o?.none as any).x4);
tell("chain behind !, member read", o => (o?.none)!.x5);
tell("chain that satisfies, member read", o => (o?.none satisfies unknown as any).x6);
tell("asserted chain, member constructed", o => new (o?.a as any).M7());
tell("asserted chain, member tested for a key", (o, k) => k in (o?.a as any).x8);
tell("asserted chain, member spread", o => [...(o?.a as any).two]);

// The chain is printed in place of a name.
tell("name of an asserted chain", o => { const r = o?.none as any; return r.x9; });
tell("name of a chain behind !", o => { const r = o?.none!; return r.x10; });
tell("name of an asserted chain in brackets", o => { const r = (o?.a as any); return r.m11(1); });

// The type stands between such a name and what reads from it.
tell("asserted name, member read", o => { const r = o?.none; return (r as any).x12; });
tell("name behind ! in brackets, member read", o => { const r = o?.none; return (r!).x13; });
tell("name behind !, member read", o => { const r = o?.none; return r!.x14; });
tell("name behind a type in angle brackets, member read", o => { const r = o?.none; return (<any>r).x15; });
tell("name that satisfies, member read", o => { const r = o?.none; return (r satisfies unknown).x16; });
tell("asserted name behind !, member read", o => { const r = o?.none; return (r as any)!.x17; });
tell("name in brackets behind !, member read", o => { const r = o?.none; return (r)!.x18; });
tell("asserted name in brackets, member read", o => { const r = o?.none; return ((r) as any).x19; });
tell("name asserted twice, member read", o => { const r = o?.none; return (r as unknown as any).x20; });
tell("asserted name, member called", o => { const r = o?.a; return (r as any).m21(1); });
tell("name behind !, member called", o => { const r = o?.a; return r!.m22(1); });
tell("asserted name, member tested for a key", o => { const r = o?.a; return "key" in (r as any).x23; });
tell("asserted name, member spread", o => { const r = o?.a; return [...(r as any).three]; });
