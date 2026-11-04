const data = { get third() { return 3; }, fourth: 4 };
console.log(JSON.stringify(structuredClone(data)));
