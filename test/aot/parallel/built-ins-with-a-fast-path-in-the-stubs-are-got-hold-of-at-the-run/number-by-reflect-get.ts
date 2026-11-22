const got = Reflect.get(globalThis, ["Nu", "mber"].join(""));
console.log("SAID", typeof got, ["1", "2.5", "x", ""].map(got), got(7), got("0x10"), got(null), got(), got({ valueOf() { return 9; } }));
