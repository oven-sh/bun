const seen: string[] = [];
abstract class Base { constructor() { seen.push(describe(this as unknown as Result)); } }
class Ok extends Base { readonly ok = true; constructor(readonly value: number) { super(); } }
class Err extends Base { readonly ok = false; constructor(readonly error: string) { super(); } }
type Result = Ok | Err;
function describe(result: Result): string { return result.ok === true ? "ok " + result.value : result.ok === false ? "err " + result.error : "neither " + String((result as { ok: unknown }).ok); }
function check(amount: number): Result { return amount > 10 ? new Ok(amount) : new Err("small"); }
for (let turn = 0; turn < 3; turn++) seen.push(describe(check(20)), describe(check(5)));
console.log(seen.join(" | "));
