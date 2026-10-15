// A `catch` block that rethrows what it caught.
function boom(v: unknown): never { throw v }
const rows: string[] = [];
function original(p: number) { const out: number[] = []; try { throw p + p; } catch (e1: any) { try { throw e1; } catch (e2: any) { out.push(e1 + e2); } } return out.join(); }
rows.push("1 " + original(4));
function innerOnly(p: number) { let r = ""; try { throw p + p; } catch (e1: any) { try { throw e1; } catch (e2: any) { r = "e2 " + e2; } } return r; }
rows.push("2 " + innerOnly(4));
function outerOnly(p: number) { let r = ""; try { throw p + p; } catch (e1: any) { try { throw e1; } catch (e2: any) { r = "e1 " + e1; } } return r; }
rows.push("3 " + outerOnly(4));
function another(p: number) { let r = ""; try { throw p + p; } catch (e1: any) { try { throw 5; } catch (e2: any) { r = "e1 " + e1 + " e2 " + e2; } } return r; }
rows.push("4 " + another(4));
function byCall(p: number) { let r = ""; try { boom(p + p); } catch (e1: any) { try { boom(e1); } catch (e2: any) { r = "e1 " + e1 + " e2 " + e2; } } return r; }
rows.push("5 " + byCall(4));
function calledThenThrown(p: object) { let r = false; try { boom(p); } catch (e1: any) { try { throw e1; } catch (e2: any) { r = e1 === e2 && e1 === p; } } return r; }
rows.push("6 " + calledThenThrown({ a: 1 }));
function afterBoth(p: number) { let kept: unknown; try { throw "s" + p; } catch (e1) { try { throw e1; } catch { kept = e1; } finally { kept = kept + "!"; } } return kept; }
rows.push("7 " + afterBoth(4));
// Nothing inspects the caught value.
function plainRethrow(p: number) { try { try { boom(p); } catch (e) { throw e; } } catch (e2) { return "caught " + e2; } return "not reached"; }
rows.push("8 " + plainRethrow(4));
function rethrowTwice(p: number) { try { try { try { boom(p); } catch (a) { throw a; } } catch (b) { throw b; } } catch (c) { return "caught " + c; } return "not reached"; }
rows.push("9 " + rethrowTwice(4));
// Out of the function.
function outOfIt(p: number) { try { boom(p); } catch (e) { throw e; } }
try { outOfIt(4); rows.push("10 not reached"); } catch (e) { rows.push("10 " + e); }
// A loop over an array in between, whose iterator is closed on the way.
function throughLoop(list: number[]) { let seen = 0; try { for (const v of list) { seen += v; if (v === 2) boom("at " + v); } } catch (e1) { try { throw e1; } catch (e2) { return e1 + " " + e2 + " " + seen; } } return "none"; }
rows.push("11 " + throughLoop([1, 2, 3]));
console.log(rows.join("\n"));

export {};
