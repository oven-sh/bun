// Maps made from literals of constant string keys and constant values: lookups, order, the first change, copies, iteration while changing, keys of other kinds, collections.
// IR+  = NewMapFromTable( table=\d+)?( @|$)
// IR= 1 fresh  = NewMapFromTable( table=\d+)?( @|$)
// IR= 0 fresh NewArray
// IR= 0 computed NewMapFromTable
const NUMBERS = new Map([["one", 1], ["two", 2], ["three", 3]]);
const TEXTS = new Map<string, string>([["one", "uno"], ["two", "dos"], ["three", "tres"], ["four", "cuatro"], ["five", "cinco"], ["six", "seis"], ["seven", "siete"], ["eight", "ocho"], ["nine", "nueve"]]);
const MIXED = new Map<string, unknown>([["n", 1.5], ["negative zero", -0], ["nan", NaN], ["big", 1e300], ["int", -2147483648], ["t", true], ["f", false], ["null", null], ["undefined", undefined], ["empty", ""], ["char", "x"], ["text", "café 中文"]]);
const THREE_HUNDRED = new Map([["code0", 0], ["code1", 3], ["code2", 6], ["code3", 9], ["code4", 12], ["code5", 15], ["code6", 18], ["code7", 21], ["code8", 24], ["code9", 27], ["code10", 30], ["code11", 33], ["code12", 36], ["code13", 39], ["code14", 42], ["code15", 45], ["code16", 48], ["code17", 51], ["code18", 54], ["code19", 57], ["code20", 60], ["code21", 63], ["code22", 66], ["code23", 69], ["code24", 72], ["code25", 75], ["code26", 78], ["code27", 81], ["code28", 84], ["code29", 87], ["code30", 90], ["code31", 93], ["code32", 96], ["code33", 99], ["code34", 102], ["code35", 105], ["code36", 108], ["code37", 111], ["code38", 114], ["code39", 117], ["code40", 120], ["code41", 123], ["code42", 126], ["code43", 129], ["code44", 132], ["code45", 135], ["code46", 138], ["code47", 141], ["code48", 144], ["code49", 147], ["code50", 150], ["code51", 153], ["code52", 156], ["code53", 159], ["code54", 162], ["code55", 165], ["code56", 168], ["code57", 171], ["code58", 174], ["code59", 177], ["code60", 180], ["code61", 183], ["code62", 186], ["code63", 189], ["code64", 192], ["code65", 195], ["code66", 198], ["code67", 201], ["code68", 204], ["code69", 207], ["code70", 210], ["code71", 213], ["code72", 216], ["code73", 219], ["code74", 222], ["code75", 225], ["code76", 228], ["code77", 231], ["code78", 234], ["code79", 237], ["code80", 240], ["code81", 243], ["code82", 246], ["code83", 249], ["code84", 252], ["code85", 255], ["code86", 258], ["code87", 261], ["code88", 264], ["code89", 267], ["code90", 270], ["code91", 273], ["code92", 276], ["code93", 279], ["code94", 282], ["code95", 285], ["code96", 288], ["code97", 291], ["code98", 294], ["code99", 297], ["code100", 300], ["code101", 303], ["code102", 306], ["code103", 309], ["code104", 312], ["code105", 315], ["code106", 318], ["code107", 321], ["code108", 324], ["code109", 327], ["code110", 330], ["code111", 333], ["code112", 336], ["code113", 339], ["code114", 342], ["code115", 345], ["code116", 348], ["code117", 351], ["code118", 354], ["code119", 357], ["code120", 360], ["code121", 363], ["code122", 366], ["code123", 369], ["code124", 372], ["code125", 375], ["code126", 378], ["code127", 381], ["code128", 384], ["code129", 387], ["code130", 390], ["code131", 393], ["code132", 396], ["code133", 399], ["code134", 402], ["code135", 405], ["code136", 408], ["code137", 411], ["code138", 414], ["code139", 417], ["code140", 420], ["code141", 423], ["code142", 426], ["code143", 429], ["code144", 432], ["code145", 435], ["code146", 438], ["code147", 441], ["code148", 444], ["code149", 447], ["code150", 450], ["code151", 453], ["code152", 456], ["code153", 459], ["code154", 462], ["code155", 465], ["code156", 468], ["code157", 471], ["code158", 474], ["code159", 477], ["code160", 480], ["code161", 483], ["code162", 486], ["code163", 489], ["code164", 492], ["code165", 495], ["code166", 498], ["code167", 501], ["code168", 504], ["code169", 507], ["code170", 510], ["code171", 513], ["code172", 516], ["code173", 519], ["code174", 522], ["code175", 525], ["code176", 528], ["code177", 531], ["code178", 534], ["code179", 537], ["code180", 540], ["code181", 543], ["code182", 546], ["code183", 549], ["code184", 552], ["code185", 555], ["code186", 558], ["code187", 561], ["code188", 564], ["code189", 567], ["code190", 570], ["code191", 573], ["code192", 576], ["code193", 579], ["code194", 582], ["code195", 585], ["code196", 588], ["code197", 591], ["code198", 594], ["code199", 597], ["code200", 600], ["code201", 603], ["code202", 606], ["code203", 609], ["code204", 612], ["code205", 615], ["code206", 618], ["code207", 621], ["code208", 624], ["code209", 627], ["code210", 630], ["code211", 633], ["code212", 636], ["code213", 639], ["code214", 642], ["code215", 645], ["code216", 648], ["code217", 651], ["code218", 654], ["code219", 657], ["code220", 660], ["code221", 663], ["code222", 666], ["code223", 669], ["code224", 672], ["code225", 675], ["code226", 678], ["code227", 681], ["code228", 684], ["code229", 687], ["code230", 690], ["code231", 693], ["code232", 696], ["code233", 699], ["code234", 702], ["code235", 705], ["code236", 708], ["code237", 711], ["code238", 714], ["code239", 717], ["code240", 720], ["code241", 723], ["code242", 726], ["code243", 729], ["code244", 732], ["code245", 735], ["code246", 738], ["code247", 741], ["code248", 744], ["code249", 747], ["code250", 750], ["code251", 753], ["code252", 756], ["code253", 759], ["code254", 762], ["code255", 765], ["code256", 768], ["code257", 771], ["code258", 774], ["code259", 777], ["code260", 780], ["code261", 783], ["code262", 786], ["code263", 789], ["code264", 792], ["code265", 795], ["code266", 798], ["code267", 801], ["code268", 804], ["code269", 807], ["code270", 810], ["code271", 813], ["code272", 816], ["code273", 819], ["code274", 822], ["code275", 825], ["code276", 828], ["code277", 831], ["code278", 834], ["code279", 837], ["code280", 840], ["code281", 843], ["code282", 846], ["code283", 849], ["code284", 852], ["code285", 855], ["code286", 858], ["code287", 861], ["code288", 864], ["code289", 867], ["code290", 870], ["code291", 873], ["code292", 876], ["code293", 879], ["code294", 882], ["code295", 885], ["code296", 888], ["code297", 891], ["code298", 894], ["code299", 897]]);
const DUPLICATES = new Map([["a", 1], ["b", 2], ["a", 3], ["c", 4], ["b", 5]]);
const ODD_KEYS = new Map([["", 0], ["0", 1], ["1", 2], ["01", 3], ["-0", 4], ["NaN", 5], ["__proto__", 6], ["constructor", 7]]);
const NUMBER_KEYS = new Map<number, string>([[1, "one"], [NaN, "not a number"], [-0, "zero"], [1.5, "half"], [0, "zero again"], [NaN, "again"]]);
const MIXED_KEYS = new Map<unknown, number>([["1", 1], [1, 2], [true, 3], ["true", 4], [null, 5], ["null", 6]]);

const out: string[] = [];
function show(value: unknown): string {
    return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
}
function say(...parts: unknown[]) {
    out.push(parts.map(show).join(" "));
}
function probes(): string[] {
    const made: string[] = [];
    for (const part of "..one,three,nine,ten,code299,code0,negative zero,nan,text,undefined,a,b,0,01,__proto__,..".slice(2, -2).split(",")) made.push(part);
    made.push("t" + "wo".slice(0), ["co", "de", "123"].join(""), String(1), "中five".slice(1), "FOUR".toLowerCase());
    return made;
}
function lookups(name: string, map: Map<string, unknown>) {
    const found: string[] = [];
    for (const probe of probes()) {
        if (map.has(probe)) found.push(probe + "=" + show(map.get(probe)));
        else if (map.get(probe) !== undefined) found.push("?" + probe);
    }
    say(name, map.size, found.join("|"));
}
function everyone() {
    lookups("numbers", NUMBERS);
    lookups("texts", TEXTS);
    lookups("mixed", MIXED);
    lookups("three hundred", THREE_HUNDRED);
    lookups("duplicates", DUPLICATES);
    lookups("odd keys", ODD_KEYS);
}
everyone();
{
    let sum = 0, texts = 0;
    const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
    for (let i = 0; i < 6000; i++) {
        sum += THREE_HUNDRED.get("code" + i) ?? -1;
        texts += (TEXTS.get(words[i % 11].slice(0) + "") ?? "").length;
    }
    say("many probes", sum, texts);
}
say("other kinds of keys", (TEXTS as Map<unknown, string>).get(1), (TEXTS as Map<unknown, string>).has(undefined), (ODD_KEYS as Map<unknown, number>).get(0), (ODD_KEYS as Map<unknown, number>).get(NaN));
say("number keys", NUMBER_KEYS.size, NUMBER_KEYS.get(NaN), NUMBER_KEYS.get(0), NUMBER_KEYS.get(-0), NUMBER_KEYS.get(1), NUMBER_KEYS.get(1.5), [...NUMBER_KEYS.keys()].map(show).join());
say("mixed keys", MIXED_KEYS.size, MIXED_KEYS.get("1"), MIXED_KEYS.get(1), MIXED_KEYS.get(true), MIXED_KEYS.get("true"), MIXED_KEYS.get(null), MIXED_KEYS.get("null"));
say("the same value twice", TEXTS.get("one") === TEXTS.get("one"), MIXED.get("text") === MIXED.get("text"), MIXED.get("text"));

say("order", [...DUPLICATES].join(";"), [...NUMBERS.keys()].join(), [...NUMBERS.values()].join(), [...MIXED.values()].map(show).join());
{
    const seen: string[] = [];
    TEXTS.forEach((value, key, map) => seen.push(map === TEXTS ? key + ":" + value : "?"));
    say("forEach", seen.join());
    let sum = 0;
    for (const [key, value] of THREE_HUNDRED) sum += key.length + value;
    say("for of", sum);
}
everyone();

say("set of a key that is there", NUMBERS.set("two", 22) === NUMBERS, NUMBERS.size, NUMBERS.get("two"), [...NUMBERS].join(";"));
say("set of a new key", TEXTS.set("ten", "diez").size, TEXTS.get("ten"), TEXTS.get("one"), [...TEXTS.keys()].join());
say("deleting what is not there", MIXED.delete("nothing"), MIXED.size);
say("deleting", MIXED.delete("nan"), MIXED.delete("nan"), MIXED.size, MIXED.has("nan"), MIXED.get("big"));
THREE_HUNDRED.clear();
say("cleared", THREE_HUNDRED.size, THREE_HUNDRED.get("code1"), [...THREE_HUNDRED].length);
THREE_HUNDRED.set("code1", -1);
say("filled again", THREE_HUNDRED.size, THREE_HUNDRED.get("code1"), THREE_HUNDRED.get("code2"));
(ODD_KEYS as Map<unknown, number>).set(0, 100);
say("a number among string keys", ODD_KEYS.size, (ODD_KEYS as Map<unknown, number>).get(0), ODD_KEYS.get("0"), [...ODD_KEYS.values()].join());

function fresh(): Map<string, number> {
    return new Map([["red", 1], ["green", 2], ["blue", 3]]);
}
function computed(n: number): Map<string, number> {
    return new Map([["red", 1], ["green", n], ["blue", 3]]);
}
{
    const first = fresh();
    const second = fresh();
    first.set("black", 0);
    second.delete("red");
    second.set("green", 20);
    say("each evaluation is its own map", first === second, [...first].join(";"), [...second].join(";"), [...fresh()].join(";"), [...computed(7)].join(";"));
    let total = 0;
    for (let i = 0; i < 20000; i++) {
        const map = fresh();
        if (i % 3 === 0) map.set("n" + i, i);
        if (i % 5 === 0) map.delete("green");
        if (i % 7 === 0) map.set("blue", 30);
        total += map.size + (map.get("green") ?? 10) + map.get("blue")! + (map.get("n" + i) ?? 0) % 11;
    }
    say("many evaluations", total);
}
{
    const source = new Map([["p", "P"], ["q", "Q"]]);
    const copy = new Map(source);
    copy.set("r", "R");
    source.delete("p");
    say("a copy", [...source].join(";"), [...copy].join(";"));
    const untouched = new Map([["p", "P"], ["q", "Q"]]);
    const second = new Map(untouched);
    say("a copy of an untouched map", second.get("q"), second.get("z"), second.size, [...second].join(";"), [...untouched].join(";"));
}
{
    const walked = new Map([["1st", 1], ["2nd", 2], ["3rd", 3]]);
    const seen: string[] = [];
    for (const [key, value] of walked) {
        seen.push(key + value);
        if (key === "1st") walked.set("4th", 4);
        if (key === "2nd") walked.delete("3rd");
        if (key === "4th") walked.set("3rd", 33);
    }
    say("changed while walked", seen.join());
    const held = new Map([["h1", 1], ["h2", 2], ["h3", 3]]);
    const early = held.entries();
    say("first", early.next().value!.join());
    held.set("h4", 4);
    held.delete("h2");
    say("the rest", [...early].join(";"));
}
class Registry extends Map<string, number> {
    set(key: string, value: number) {
        return super.set(key.toUpperCase(), value * 2);
    }
}
say("subclass", [...new Registry([["a", 1], ["b", 2]])].join(";"));
say("frozen", Object.isFrozen(Object.freeze(new Map([["f", 1]])).set("g", 2)));
say("grouped", Object.fromEntries(new Map([["x", 1], ["y", 2]])).y, JSON.stringify([...new Map([["k", "v"]])]));
{
    const kept: Map<string, string>[] = [];
    for (let round = 0; round < 300; round++) {
        const map = new Map([["keep-a", "value-a"], ["keep-b", "value-b"], ["keep-c", "value-c"], ["keep-d", "value-d"], ["keep-e", "value-e"]]);
        if (round % 2) map.set("more-" + round, "m");
        if (round % 7 === 0) kept.push(map);
        const garbage: string[] = [];
        for (let i = 0; i < 200; i++) garbage.push("g" + round + "-" + i);
        if (garbage.length !== 200) say("?");
    }
    let sum = 0;
    for (const map of kept) {
        sum += map.get("keep-e")!.length;
        for (const [key, value] of map) sum += key.length + value.length;
    }
    say("kept across collections", kept.length, sum);
}
console.log(out.join("\n"));
