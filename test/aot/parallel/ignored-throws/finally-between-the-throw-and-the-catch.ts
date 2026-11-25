// a finally stands between the throw and the catch that ignores it: it runs on the way, and may return, break or throw over the throw
let log = "";
function passes(bad: unknown) { try { try { if (bad) throw new Error("bad"); log += "fine;"; } finally { log += "finally;"; } } catch { return "caught"; } return "done"; }
function returns(bad: unknown) { try { try { if (bad) throw new Error("bad"); } finally { if (bad) return "returned"; } } catch { return "caught"; } return "done"; }
function breaks(bad: unknown) { try { for (;;) { try { if (bad) throw new Error("bad"); break; } finally { if (bad) break; } } } catch { return "caught"; } return "done"; }
function throwsOver(bad: unknown) { try { try { if (bad) throw new Error("first"); } finally { if (bad) throw new RangeError("second"); } } catch (e) { return (e as Error).message; } return "done"; }
function deed(f: (bad: unknown) => string, bad: unknown) { log = ""; return f(bad) + ":" + log; }
for (const f of [passes, returns, breaks, throwsOver]) { console.log(deed(f, false)); console.log(deed(f, true)); let text = ""; for (let i = 0; i < 4; i++) text += deed(f, i & 1) + "|"; console.log(text); }
