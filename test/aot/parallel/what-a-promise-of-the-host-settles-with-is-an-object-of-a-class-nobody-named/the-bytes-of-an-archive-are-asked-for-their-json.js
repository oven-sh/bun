const bytes = await new Bun.Archive({ "note.txt": "hello" }).bytes();
console.log(typeof bytes.toJSON().type);
