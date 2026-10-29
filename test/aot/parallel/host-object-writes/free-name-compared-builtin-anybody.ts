// A store to the global object under a key that nobody knows: every free name may have been replaced, so each use tests whether the name still holds the built-in object.
// The first test of each name comes before anybody has asked for that object, and later the names hold values of every kind.
const hide = new Function("v", "return v" + String(process.argv[9] ?? "").slice(99)) as <T>(v: T) => T;
const globals = globalThis as unknown as Record<string, unknown>;
globals[hide("nobodyReadsThis")] = hide<unknown>(1);
hide(navigator); hide(console); hide(Date); hide(Intl); hide(Buffer); hide(Error); hide(Promise); hide(URL);

function agentIsText(): unknown { return typeof navigator.userAgent; }
function platformIsText(): unknown { return typeof navigator.platform; }
function logIsFunction(): unknown { return typeof console.log; }
function nowIsNumber(): unknown { return typeof Date.now(); }
function formats(): unknown { return typeof Intl.NumberFormat; }
function bytes(text: string): unknown { return Buffer.byteLength(text); }
function isError(value: unknown): unknown { return value instanceof Error; }
function resolves(): unknown { return typeof Promise.resolve(1).then; }
function parses(text: string): unknown { return URL.canParse(text); }
function notANumber(value: number): unknown { return isNaN(value); }
function whole(text: string): unknown { return parseInt(text, 10); }
function sameObject(value: unknown): unknown { return [value === navigator, value === console, value === Intl, value === Date, value === Buffer]; }

const uses: [string, () => unknown][] = [
    ["navigator", () => agentIsText()], ["navigator", () => platformIsText()], ["console", () => logIsFunction()], ["Date", () => nowIsNumber()], ["Intl", () => formats()],
    ["Buffer", () => bytes("abc")], ["Error", () => isError(new TypeError("t"))], ["Promise", () => resolves()], ["URL", () => parses("http://a/")], ["isNaN", () => notANumber(NaN)], ["parseInt", () => whole("12px")],
];
const print = console.log.bind(console);
function attempt(label: string, run: () => unknown) {
    try {
        print(label, globalsText(run()));
    } catch (error) {
        print(label, "throws", String((error as { name?: unknown }).name));
    }
}
const stringify = JSON.stringify;
function globalsText(value: unknown): string { return typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? "bigint" : String(stringify(value)); }

for (const [name, run] of uses) attempt("as the realm made it, " + name + ":", run);
for (const value of [navigator, console, Intl, Date, Buffer, {}, null, undefined, 0, "navigator"]) attempt("the same object:", () => sameObject(hide(value)));

const replacements: [string, unknown][] = [
    ["an object of the program", { userAgent: 7, platform: 7, log: 7, now: () => "mine", NumberFormat: 7, byteLength: () => "mine", resolve: () => ({ then: 7 }), canParse: () => "mine" }],
    ["undefined", undefined], ["null", null], ["zero", 0], ["a negative number", -1.5], ["NaN", NaN], ["an empty string", ""], ["true", true], ["false", false],
    ["a symbol", Symbol("s")], ["a bigint", 10n], ["a function", function () { return 1; }], ["another built-in object", Reflect], ["the built-in object of another name", Intl],
];
for (const [kind, replacement] of replacements) {
    for (const [name, run] of uses) {
        const original = globals[hide(name)];
        globals[hide(name)] = hide(replacement);
        attempt(name + " holds " + kind + ":", run);
        globals[hide(name)] = original;
        attempt(name + " holds the built-in object again:", run);
    }
}
