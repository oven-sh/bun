// A place whose type says "a function that yields a number or nothing" holds, in turn, functions that yield a number and functions that yield nothing. A call of what the place holds takes the number as it is, without a box. Only a function across whose own parameters or result a number goes gets an entry of its own for such calls: for one that yields nothing there is nothing to spare.
// IR- ^function f\d+ "yieldsNothing" \w+ role=SignatureEntrypoint
// IR- ^function f\d+ "takesNothingAndYieldsNothing" \w+ role=SignatureEntrypoint
const lines: string[] = [];
let count = 0;
type MayYieldANumber = () => number | undefined;
type TakesANumber = (x: number) => number | undefined;
const yieldsANumber: MayYieldANumber = (): number => 40.5 + count;
const yieldsAnotherNumber: MayYieldANumber = (): number => count * 2.25;
const yieldsNothing: MayYieldANumber = (): undefined => { count++; return undefined; };
const yieldsEither: MayYieldANumber = (): number | undefined => (count & 1 ? count + 0.5 : undefined);
const halves: TakesANumber = (x: number): number => x / 2;
const forgets: TakesANumber = (x: number): undefined => { count += x; return undefined; };
const takesNothingAndYieldsNothing: TakesANumber = (): undefined => { count += 3; return undefined; };
const withoutArguments: MayYieldANumber[] = [yieldsANumber, yieldsNothing, yieldsAnotherNumber, yieldsEither, yieldsNothing, yieldsEither];
const withOneArgument: TakesANumber[] = [halves, forgets, takesNothingAndYieldsNothing, halves];
let held: MayYieldANumber = yieldsANumber;
let taking: TakesANumber = halves;
function callHeld(): number { const got = held(); return got === undefined ? -1 : got + 0.25; }
function callTaking(x: number): number { const got = taking(x); return got === undefined ? -2 : got + 0.125; }
for (let round = 0; round < 3; round++) {
    for (const f of withoutArguments) { held = f; lines.push(round + " " + f.name + " " + callHeld() + " " + count); }
    for (const f of withOneArgument) { taking = f; lines.push(round + " " + f.name + " " + callTaking(round + 1.5) + " " + count); }
}
console.log(lines.join("\n"));
