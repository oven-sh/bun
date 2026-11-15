const held = { bytes: await new Bun.Archive({ "note.txt": "hello" }).bytes() };
console.log(JSON.stringify(held).length > 0);
