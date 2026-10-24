// One statement stores to `process` under a computed key, so every member of it may be replaced and none is locked. Then a definition and a deletion that reach `process`
// through a receiver that the compiler does not follow work too, and every later read by name sees them.
const hidden = JSON.parse('["process"]').map(name => globalThis[name]);
const keyOf = text => JSON.parse(JSON.stringify(text));
process[keyOf("aNameOfMyOwn")] = 1;

function readRelease() { return process.release; }
function readFeatures() { return process.features; }
function readVersions() { return process.versions; }
function readConfig() { return process.config; }

function report(label, read, expected) {
    let same = 0;
    for (let i = 0; i < 2000; i++) {
        if (read() === expected)
            same++;
    }
    console.log(label, same, typeof expected);
}

report("release, at first:", readRelease, hidden[0].release);
report("features, at first:", readFeatures, hidden[0].features);
report("versions, at first:", readVersions, hidden[0].versions);
report("config, at first:", readConfig, hidden[0].config);
const mine = () => {};
Object.defineProperty(hidden[0], keyOf("release"), { value: mine, writable: true, configurable: true, enumerable: true });
report("release, replaced by a definition:", readRelease, mine);
Reflect.defineProperty(hidden[0], keyOf("features"), { get() { return "from a getter"; }, configurable: true });
report("features, with a getter defined:", readFeatures, "from a getter");
delete hidden[0][keyOf("versions")];
report("versions, deleted:", readVersions, undefined);
Reflect.deleteProperty(hidden[0], keyOf("config"));
report("config, deleted:", readConfig, undefined);
