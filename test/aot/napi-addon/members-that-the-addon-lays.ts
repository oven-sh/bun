// The addon answers objects with members that the host looks for: a method that prints the object, toJSON, Symbol.toPrimitive, Symbol.toStringTag, then. Nothing here names them.
const loaded: { exports: any } = { exports: {} }; process.dlopen(loaded, process.env.ADDON!); const addon: any = loaded.exports;
console.log(addon.makePrinted());
console.log([addon.makePrinted()], { deep: { deeper: addon.makePrinted() } }, new Map([[1, addon.makePrinted()]]));
console.log(Bun.inspect(addon.makePrinted()));
console.log("%o | %O", addon.makePrinted(), addon.makePrinted());
console.table([addon.makePrinted(), { a: addon.makePrinted() }]);
console.log(JSON.stringify({ a: addon.makeWithToJSON() }), JSON.stringify([addon.makeWithToJSON()]));
console.log(`${addon.makeWithToPrimitive()}`, addon.makeWithToPrimitive() + "!", String(addon.makeWithToPrimitive()), [addon.makeWithToPrimitive()].join(), addon.makeWithToPrimitive() == "text of the addon");
console.log(Object.prototype.toString.call(addon.makeWithTag()), String(addon.makeWithTag()));
console.log(await addon.makeThenable(), await Promise.resolve(addon.makeThenable()), await Promise.all([addon.makeThenable()]), await (async () => addon.makeThenable())());
console.log(addon.makeWithToJSON(), addon.makeWithToPrimitive(), addon.makeWithTag(), addon.makeThenable());
export {};
