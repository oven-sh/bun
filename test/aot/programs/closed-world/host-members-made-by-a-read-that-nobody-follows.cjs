// A member that the host makes when it is first looked for (process.env, process.nextTick, process.stdout, Bun.stdin ..) may be made by any read: one under a computed key, one through a receiver
// that the compiler does not follow, a test with `in`, a descriptor. Whoever made it, later reads by name give that same object, until the program replaces it, and then they give what the program put there.
const hidden = JSON.parse('["process", "Bun"]').map(name => globalThis[name]);
const keyOf = text => JSON.parse(JSON.stringify(text));
process[keyOf("aNameOfMyOwn")] = 1;
Bun[keyOf("aNameOfMyOwn")] = 1;

function readEnv() { return process.env; }
function readNextTick() { return process.nextTick; }
function readStdout() { return process.stdout; }
function readVersions() { return process.versions; }
function readBunStdin() { return Bun.stdin; }

function report(label, read, first) {
    let same = 0;
    for (let i = 0; i < 2000; i++) {
        if (read() === first)
            same++;
    }
    console.log(label, same, typeof first);
}

report("env, made under a computed key:", readEnv, process[keyOf("env")]);
report("nextTick, made through a receiver nobody follows:", readNextTick, hidden[0].nextTick);
report("stdout, made by a descriptor:", readStdout, Object.getOwnPropertyDescriptor(process, keyOf("stdout")).value ?? process.stdout);
report("versions, made by Reflect.get:", readVersions, Reflect.get(hidden[0], keyOf("versions")));
report("Bun.stdin, made under a computed key:", readBunStdin, hidden[1][keyOf("stdin")]);

const mine = { HOME: "mine" };
hidden[0][keyOf("env")] = mine;
report("env, replaced through a receiver nobody follows:", readEnv, mine);
