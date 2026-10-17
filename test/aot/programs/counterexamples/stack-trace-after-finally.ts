// The stack trace of an error that passed through `finally` names the function that threw.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function thrower() { throw new Error("x") }
function holder() { try { thrower() } finally { hide(0) } }
row("the trace behind a finally", () => { try { holder() } catch (e) { return String((e as Error).stack).split("\n").slice(0, 3).map(l => l.replace(/@.*|\s*\(.*/, "").trim()).join() } });
