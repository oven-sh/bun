// The three built-ins that join are reached under other names, and locals bear their names: what is called goes by the binding and never by the text.
const joinOfLists = Array.prototype.join;
const concatOfStrings = String.prototype.concat;
const rawOfString = String.raw;

function renamed(a: string, b: number): string {
    return joinOfLists.call([a, b], "-") + "|" + concatOfStrings.call(a, b as any, "!") + "|" + rawOfString`${a}\t${b}`;
}

function shadowed(a: string, b: number): string {
    const String = { raw(texts: TemplateStringsArray, ...values: unknown[]) { return texts.length + ":" + values.length; } };
    const list = { join(separator: string) { return "mine" + separator; } };
    const text = { concat(...parts: unknown[]) { return "mine" + parts.length; } };
    return String.raw`${a}\t${b}` + "|" + list.join("-") + "|" + text.concat(a, b);
}

function tagged(a: string, b: number): string {
    const keep = (texts: TemplateStringsArray, ...values: unknown[]) => texts.join("_") + "|" + texts.raw.join("_") + "|" + values.join("_");
    return keep`x\n${a}y${b}`;
}

function deed(a: string, b: number) {
    console.log(JSON.stringify(renamed(a, b)), JSON.stringify(shadowed(a, b)), JSON.stringify(tagged(a, b)));
}

deed("a", 1);
deed("", -0);
for (let turn = 0; turn < 3; turn++)
    deed("t" + turn, turn / 2);
