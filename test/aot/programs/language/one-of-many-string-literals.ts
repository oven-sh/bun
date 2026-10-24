// A value is tested for a union of string literals of 1, 2, 3, 4, 12 and 70 members, with every kind of value: members, other literals of the program,
// strings made at run time that equal a member, strings that equal none, ropes, and what is no string.
type One = "alpha";
type Two = "alpha" | "beta";
type Three = Two | "gamma";
type Four = Three | "delta";
type Twelve = Four | "epsilon" | "zeta" | "eta" | "theta" | "iota" | "kappa" | "lambda" | "mu";

const seventy = [
    "k00", "k01", "k02", "k03", "k04", "k05", "k06", "k07", "k08", "k09", "k10", "k11", "k12", "k13", "k14", "k15", "k16", "k17", "k18", "k19",
    "k20", "k21", "k22", "k23", "k24", "k25", "k26", "k27", "k28", "k29", "k30", "k31", "k32", "k33", "k34", "k35", "k36", "k37", "k38", "k39",
    "k40", "k41", "k42", "k43", "k44", "k45", "k46", "k47", "k48", "k49", "k50", "k51", "k52", "k53", "k54", "k55", "k56", "k57", "k58", "k59",
    "k60", "k61", "k62", "k63", "k64", "k65", "k66", "k67", "k68", "k69",
] as const;
type Seventy = (typeof seventy)[number];

function takesOne(value: One): string { return "one:" + value; }
function takesTwo(value: Two): string { return "two:" + value; }
function takesThree(value: Three): string { return "three:" + value; }
function takesFour(value: Four): string { return "four:" + value; }
function takesTwelve(value: Twelve): string { return "twelve:" + value; }
function takesSeventy(value: Seventy): string { return "seventy:" + value; }

function isTwelve(value: unknown): value is Twelve {
    return value === "alpha" || value === "beta" || value === "gamma" || value === "delta" || value === "epsilon" || value === "zeta"
        || value === "eta" || value === "theta" || value === "iota" || value === "kappa" || value === "lambda" || value === "mu";
}

function rankOf(value: Twelve): number {
    switch (value) {
    case "alpha": return 1;
    case "beta": return 2;
    case "gamma": return 3;
    case "delta": return 4;
    case "epsilon": return 5;
    case "zeta": return 6;
    case "eta": return 7;
    case "theta": return 8;
    case "iota": return 9;
    case "kappa": return 10;
    case "lambda": return 11;
    case "mu": return 12;
    }
}

const takers: ((value: any) => string)[] = [takesOne, takesTwo, takesThree, takesFour, takesTwelve, takesSeventy];

function made(text: string): string {
    return text.split("").join("");
}

const values: unknown[] = [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "", "a", "k00", "k31", "k32", "k63", "k64", "k69", "k70",
    made("alpha"), made("mu"), made("k69"), made("omega"), "al" + made("pha"), "k" + String(6) + String(4), made("Alpha"), "alpha ", "α",
    undefined, null, true, false, 0, 1, -0, NaN, 1.5, 10n, Symbol.for("alpha"), {}, [], ["alpha"], new String("alpha"), { toString() { return "alpha"; } }, () => "alpha",
];

for (let round = 0; round < 3; round++) {
    for (const value of values) {
        const row: string[] = [];
        for (const taker of takers) {
            try {
                row.push(taker(value));
            } catch (error) {
                row.push((error as Error).constructor.name);
            }
        }
        console.log(round, typeof value, isTwelve(value) ? rankOf(value) : "-", row.join(" "));
    }
}
