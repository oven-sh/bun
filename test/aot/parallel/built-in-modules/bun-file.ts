const file = Bun.file("/no/such/file");
console.log(await file.exists(), file.size);

export {};
