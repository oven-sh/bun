// Sets made from literals of constant strings: lookups with every kind of key, order, the first change, copies, iteration while changing, subclasses, collections.
// IR+  = NewSetFromTable( table=\d+)?( @|$)
// IR= 1 fresh  = NewSetFromTable( table=\d+)?( @|$)
// IR= 0 fresh NewArray
const ONE = new Set(["only"]);
const TWO = new Set(["a", "bb"]);
const EIGHT = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]);
const NINE = new Set(["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"]);
const FORTY = new Set(["name-0", "name-1", "name-2", "name-3", "name-4", "name-5", "name-6", "name-7", "name-8", "name-9", "name-10", "name-11", "name-12", "name-13", "name-14", "name-15", "name-16", "name-17", "name-18", "name-19", "name-20", "name-21", "name-22", "name-23", "name-24", "name-25", "name-26", "name-27", "name-28", "name-29", "name-30", "name-31", "name-32", "name-33", "name-34", "name-35", "name-36", "name-37", "name-38", "name-39"]);
const THREE_HUNDRED = new Set(["key0", "key1", "key2", "key3", "key4", "key5", "key6", "key7", "key8", "key9", "key10", "key11", "key12", "key13", "key14", "key15", "key16", "key17", "key18", "key19", "key20", "key21", "key22", "key23", "key24", "key25", "key26", "key27", "key28", "key29", "key30", "key31", "key32", "key33", "key34", "key35", "key36", "key37", "key38", "key39", "key40", "key41", "key42", "key43", "key44", "key45", "key46", "key47", "key48", "key49", "key50", "key51", "key52", "key53", "key54", "key55", "key56", "key57", "key58", "key59", "key60", "key61", "key62", "key63", "key64", "key65", "key66", "key67", "key68", "key69", "key70", "key71", "key72", "key73", "key74", "key75", "key76", "key77", "key78", "key79", "key80", "key81", "key82", "key83", "key84", "key85", "key86", "key87", "key88", "key89", "key90", "key91", "key92", "key93", "key94", "key95", "key96", "key97", "key98", "key99", "key100", "key101", "key102", "key103", "key104", "key105", "key106", "key107", "key108", "key109", "key110", "key111", "key112", "key113", "key114", "key115", "key116", "key117", "key118", "key119", "key120", "key121", "key122", "key123", "key124", "key125", "key126", "key127", "key128", "key129", "key130", "key131", "key132", "key133", "key134", "key135", "key136", "key137", "key138", "key139", "key140", "key141", "key142", "key143", "key144", "key145", "key146", "key147", "key148", "key149", "key150", "key151", "key152", "key153", "key154", "key155", "key156", "key157", "key158", "key159", "key160", "key161", "key162", "key163", "key164", "key165", "key166", "key167", "key168", "key169", "key170", "key171", "key172", "key173", "key174", "key175", "key176", "key177", "key178", "key179", "key180", "key181", "key182", "key183", "key184", "key185", "key186", "key187", "key188", "key189", "key190", "key191", "key192", "key193", "key194", "key195", "key196", "key197", "key198", "key199", "key200", "key201", "key202", "key203", "key204", "key205", "key206", "key207", "key208", "key209", "key210", "key211", "key212", "key213", "key214", "key215", "key216", "key217", "key218", "key219", "key220", "key221", "key222", "key223", "key224", "key225", "key226", "key227", "key228", "key229", "key230", "key231", "key232", "key233", "key234", "key235", "key236", "key237", "key238", "key239", "key240", "key241", "key242", "key243", "key244", "key245", "key246", "key247", "key248", "key249", "key250", "key251", "key252", "key253", "key254", "key255", "key256", "key257", "key258", "key259", "key260", "key261", "key262", "key263", "key264", "key265", "key266", "key267", "key268", "key269", "key270", "key271", "key272", "key273", "key274", "key275", "key276", "key277", "key278", "key279", "key280", "key281", "key282", "key283", "key284", "key285", "key286", "key287", "key288", "key289", "key290", "key291", "key292", "key293", "key294", "key295", "key296", "key297", "key298", "key299"]);
const ODD_KEYS = new Set(["", "0", "1", "01", "-0", "1e3", "NaN", "undefined", "null", "true", " ", "__proto__", "constructor", "a b", "\t", "\\", "\"", "x".repeat(0) + "y"]);
const DUPLICATES = new Set(["x", "y", "x", "z", "y", "x"]);
const NOT_ASCII = new Set(["café", "naïve", "中文", "plain"]);

const LONG_KEYS = new Set(["llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllll", "lllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllm", "short"]);

const out: string[] = [];
function say(...parts: unknown[]) {
    out.push(parts.map(part => (typeof part === "string" ? JSON.stringify(part) : String(part))).join(" "));
}

function probes(): string[] {
    const made: string[] = [];
    const whole = "..alpha,beta,key299,name-39,only,bb,0,01,NaN,__proto__,café,中文,nothing..";
    for (const part of whole.slice(2, -2).split(",")) made.push(part);
    made.push("al" + "pha".slice(0), ["ke", "y1", "23"].join(""), String(1), String(-0), `${1000}`, "ALPHA".toLowerCase(), "key" + 300, "", " ".trim());
    made.push("中alpha".slice(1), "中key7".substring(1));
    return made;
}

function membership(name: string, set: Set<string>) {
    const found: string[] = [];
    for (const probe of probes()) {
        if (set.has(probe)) found.push(probe);
    }
    say(name, set.size, found.join("|"));
}

function everyone() {
    membership("one", ONE);
    membership("two", TWO);
    membership("eight", EIGHT);
    membership("nine", NINE);
    membership("forty", FORTY);
    membership("three hundred", THREE_HUNDRED);
    membership("odd keys", ODD_KEYS);
    membership("duplicates", DUPLICATES);
    membership("not ASCII", NOT_ASCII);
}

everyone();
{
    let inThreeHundred = 0, inForty = 0, inNine = 0, inEight = 0, inTwo = 0;
    for (let i = 0; i < 6000; i++) {
        if (THREE_HUNDRED.has("key" + i)) inThreeHundred++;
        if (FORTY.has("name-" + i)) inForty++;
        const word = String.fromCharCode(97 + (i % 26), 97 + ((i >> 3) % 26)) + (i % 7 ? "" : "ta");
        if (NINE.has(word)) inNine++;
        if (EIGHT.has(word)) inEight++;
        if (TWO.has(word)) inTwo++;
    }
    say("many probes", inThreeHundred, inForty, inNine, inEight, inTwo);
    say("long keys", LONG_KEYS.has("l".repeat(300)), LONG_KEYS.has("l".repeat(299) + "m"), LONG_KEYS.has("l".repeat(299)), LONG_KEYS.has("l".repeat(299) + "n"), LONG_KEYS.has("sho" + "rt".slice(0)), LONG_KEYS.size);
}
say("other kinds of keys", (EIGHT as Set<unknown>).has(1), (EIGHT as Set<unknown>).has(undefined), (EIGHT as Set<unknown>).has(null), (EIGHT as Set<unknown>).has({}), (ODD_KEYS as Set<unknown>).has(0), (ODD_KEYS as Set<unknown>).has(NaN), (ODD_KEYS as Set<unknown>).has(Symbol.iterator));

say("order", [...NINE].join(), [...DUPLICATES].join(), Array.from(TWO).join(), [...ODD_KEYS].map(key => JSON.stringify(key)).join());
say("keys values entries", [...EIGHT.keys()].join(), [...EIGHT.values()].join(), [...TWO.entries()].join(";"));
{
    const seen: string[] = [];
    FORTY.forEach((value, key, set) => seen.push(value === key && set === FORTY ? value : "?"));
    say("forEach", seen.length, seen[0], seen[39]);
    let count = 0;
    for (const key of THREE_HUNDRED) count += key.length;
    say("for of", count);
}
everyone();

say("adding what is there", EIGHT.add("alpha") === EIGHT, EIGHT.size, [...EIGHT].join());
say("deleting what is not there", NINE.delete("kappa"), NINE.size);
say("adding", NINE.add("kappa").size, NINE.has("kappa"), NINE.has("alpha"), [...NINE].join());
say("deleting", FORTY.delete("name-0"), FORTY.delete("name-0"), FORTY.size, FORTY.has("name-0"), FORTY.has("name-1"), [...FORTY].slice(0, 3).join());
THREE_HUNDRED.clear();
say("cleared", THREE_HUNDRED.size, THREE_HUNDRED.has("key1"), [...THREE_HUNDRED].length);
THREE_HUNDRED.add("key1");
say("filled again", THREE_HUNDRED.size, THREE_HUNDRED.has("key1"), THREE_HUNDRED.has("key2"));
(TWO as Set<unknown>).add(7);
say("a number among strings", TWO.size, (TWO as Set<unknown>).has(7), TWO.has("a"), [...TWO].join());

function fresh(): Set<string> {
    return new Set(["red", "green", "blue"]);
}
{
    const first = fresh();
    const second = fresh();
    first.add("black");
    second.delete("red");
    const third = fresh();
    say("each evaluation is its own set", first === second, [...first].join(), [...second].join(), [...third].join());
    let total = 0;
    for (let i = 0; i < 20000; i++) {
        const set = fresh();
        if (i % 3 === 0) set.add("n" + i);
        if (i % 5 === 0) set.delete("green");
        total += set.size + (set.has("green") ? 10 : 0) + (set.has("n" + i) ? 100 : 0);
    }
    say("many evaluations", total);
}

{
    const source = new Set(["p", "q", "r"]);
    const copy = new Set(source);
    copy.add("s");
    source.delete("p");
    say("a copy", [...source].join(), [...copy].join());
    const untouched = new Set(["p", "q", "r"]);
    const second = new Set(untouched);
    say("a copy of an untouched set", second.has("q"), second.has("z"), second.size, [...second].join(), [...untouched].join());
}

{
    const walked = new Set(["1st", "2nd", "3rd"]);
    const seen: string[] = [];
    for (const key of walked) {
        seen.push(key);
        if (key === "1st") walked.add("4th");
        if (key === "2nd") walked.delete("3rd");
        if (key === "4th") walked.add("3rd");
    }
    say("changed while walked", seen.join());
    const iterator = new Set(["x1", "x2", "x3"]).values();
    say("an iterator alone", iterator.next().value, iterator.next().value, iterator.next().value, iterator.next().done);
    const held = new Set(["h1", "h2", "h3"]);
    const early = held.values();
    say("first", early.next().value);
    held.add("h4");
    held.delete("h2");
    say("the rest", [...early].join());
    const cleared = new Set(["c1", "c2"]);
    const over = cleared.keys();
    over.next();
    cleared.clear();
    cleared.add("c3");
    say("after clear", [...over].join());
}

{
    const frozen = Object.freeze(new Set(["f1", "f2"]));
    frozen.add("f3");
    say("frozen", Object.isFrozen(frozen), frozen.size, frozen.has("f3"));
    const extended = new Set(["e1"]) as Set<string> & { note?: string };
    extended.note = "kept";
    say("own property", extended.note, extended.has("e1"), Object.keys(extended).join());
}

class Names extends Set<string> {
    added = 0;
    add(value: string) {
        this.added = (this.added ?? 0) + 1;
        return super.add(value.toUpperCase());
    }
}
{
    const names = new Names(["ann", "bob", "ann"]);
    say("subclass", names.size, names.has("ANN"), names.has("ann"), [...names].join(), names instanceof Set);
}

{
    const left = new Set(["a", "b", "c", "d"]);
    const right = new Set(["c", "d", "e"]);
    say("set methods", [...left.union(right)].join(), [...left.intersection(right)].join(), [...left.difference(right)].join(), [...left.symmetricDifference(right)].join(), left.isSubsetOf(right), new Set(["c"]).isSubsetOf(right), left.isSupersetOf(new Set(["a", "d"])), left.isDisjointFrom(new Set(["x", "y"])));
    say("still whole", [...left].join(), [...right].join());
}

{
    const kept: Set<string>[] = [];
    for (let round = 0; round < 300; round++) {
        const set = new Set(["keep-a", "keep-b", "keep-c", "keep-d", "keep-e", "keep-f", "keep-g", "keep-h", "keep-i", "keep-j"]);
        if (round % 2) set.add("more-" + round);
        if (round % 7 === 0) kept.push(set);
        const garbage: string[] = [];
        for (let i = 0; i < 200; i++) garbage.push("g" + round + "-" + i);
        if (garbage.length !== 200) say("?");
    }
    let sum = 0;
    for (const set of kept) {
        for (const key of set) sum += key.length;
        sum += set.has("keep-j") ? 1 : 0;
    }
    say("kept across collections", kept.length, sum);
}

say("to string", Object.prototype.toString.call(ONE), ONE.constructor === Set, Object.getPrototypeOf(ONE) === Set.prototype);
console.log(out.join("\n"));
