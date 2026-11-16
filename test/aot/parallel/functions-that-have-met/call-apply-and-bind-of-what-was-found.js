const hidden = value => { try { throw value; } catch (caught) { return caught; } };
const kit = hidden({ scale(by) { return this.base * by; }, base: 3 });
console.log(kit.scale.call({ base: 2 }, 5), kit.scale.apply({ base: 4 }, [2]), kit.scale.bind({ base: 1 })(7), Reflect.apply(kit.scale, { base: 6 }, [2]));
