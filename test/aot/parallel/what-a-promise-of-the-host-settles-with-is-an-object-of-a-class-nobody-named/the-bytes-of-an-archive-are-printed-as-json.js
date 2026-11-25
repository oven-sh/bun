const bytes = await new Bun.Archive({ "note.txt": "hello" }).bytes();
console.log(JSON.stringify(bytes).length > 0);
