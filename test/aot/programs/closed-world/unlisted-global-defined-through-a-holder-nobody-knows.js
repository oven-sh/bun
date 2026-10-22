const holders = [{}, globalThis, {}];
const holder = holders[Number(process.env.INDEX ?? 1)];
holder.__throughAHolder = () => "through a holder";
const parsed = JSON.parse(process.env.TEXT ?? '{"at":1}');
holders[parsed.at]["__throughAHolder" + "Too"] = () => "too";
console.log(globalThis.__throughAHolder(), globalThis.__throughAHolderToo());
