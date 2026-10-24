console.log(globalThis.__fromParsedText);
Object.assign(globalThis, JSON.parse(process.env.TEXT ?? '{"__fromParsedText":{"deep":[1,2]}}'));
console.log(JSON.stringify(globalThis.__fromParsedText), globalThis.__fromParsedText.deep.length);
