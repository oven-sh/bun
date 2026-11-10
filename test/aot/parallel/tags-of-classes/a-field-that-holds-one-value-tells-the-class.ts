// STATISTIC: MethodCallsThroughTable = 0
class Ok { readonly ok = true; constructor(readonly value: number) {} double(): Ok { return new Ok(this.value * 2); } }
class Err { readonly ok = false; constructor(readonly error: string) {} double(): Err { return this; } }
function check(amount: number): Ok | Err { return amount > 10 ? new Ok(amount) : new Err("small"); }
const amounts: number[] = JSON.parse("[5,20,7,40,11,3,99,10]");
function run(): string {
    const said: string[] = [];
    for (const amount of amounts) {
        const result = check(amount);
        if (result.ok === true) said.push("ok " + result.double().value);
        else said.push("err " + result.error);
    }
    return said.join(" | ");
}
console.log(run());
