class Ok { readonly ok = true; constructor(readonly value: number) {} double(): Ok { return new Ok(this.value * 2); } }
class Err { readonly ok = false; constructor(readonly error: string) {} double(): Err { return this; } }
type Result = Ok | Err;
function check(amount: number): Result { return amount > 10 ? new Ok(amount) : new Err("small"); }
function tell(result: Result): string { if (result.ok) return "ok " + result.double().value; else return "err " + result.error; }
function tellByEquals(result: Result): string { return result.ok === true ? "ok " + result.double().value : "err " + result.error; }
function tellByNot(result: Result): string { return !result.ok ? "err " + result.error : "ok " + result.double().value; }
const say = (what: string, result: Result) => { let said: string; try { said = tell(result) + " | " + tellByEquals(result) + " | " + tellByNot(result); } catch (error) { said = (error as Error).constructor.name; } console.log(what + ": " + said); };
for (let turn = 0; turn < 3; turn++) { say("as made", check(20)); say("as made", check(5)); }
const changed = check(20); (changed as any).ok = false; (changed as any).error = "now an error"; say("stored false", changed);
const other = check(5); (other as any).ok = true; (other as any).value = 7; say("stored true", other);
