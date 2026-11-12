const got = Object.getOwnPropertyDescriptor(globalThis, ["St", "ring"].join(""))!.value;
console.log("SAID", typeof got, [1, 2.5, -0, NaN].map(got), got("t"), got(null), got(), got({ toString() { return "o"; } }), got(Symbol("s")));
