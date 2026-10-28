// Prints where a stack trace places a call or a member access on a value that Bun's transpiler folds from constants with types and from members of enums.
function show(run: () => unknown) {
  try {
    run();
    console.log(run.name, "no error");
  } catch (error: any) {
    console.log(run.name, error.constructor.name, /:(\d+:\d+)\)?$/.exec(String(error.stack).split("\n")[1])![1]);
  }
}
enum Level { Low = 1, High = Low + 1, Name = "n" }
show(function e1() { const a: string = "x"; const b: any = a + "y"; return b(); });
show(function e2() { const a = "x" as string; const b = (a + "y") as any; const c = (b + "z") as any; return c(); });
show(function e3() { const a = 2 as number; const b = -a; const c = -b; const d: any = c ? null : 1; return d.x; });
show(function e4() { const a = Level.High; const b: any = a + "y"; return b(); });
show(function e5() { const a = Level.Name; const b: any = a + "y"; return b(); });
show(function e6() { const b: any = Level.Name + "y"; return b(); });
show(function e7() { const b: any = Level.High + 1; return b(); });
show(function e8() { const a = Level.High; const b: any = a + 1; return b(); });
show(function e9() { const a = Level.High; const b = -a; const d: any = b ? null : 1; return d.x; });
show(function e10() { const a = Level.Low; const d: any = a ? null : 1; return d.x; });
show(function e11() { const a = Level.Name; const b: any = a.length; return b(); });
show(function e12() { const a = "x"!; const b: any = a! + "y"; return b(); });
show(function e13() { const a = <string>"x"; const b: any = a + "y"; return b(); });
show(function e14() { const a = "x" satisfies string; const b: any = a + "y"; return b(); });
