const file = Bun.file("/no/such/file/here.txt");
console.log(file instanceof Blob, file.name.length, await file.exists(), typeof file.size);
