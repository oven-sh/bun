const post = globalThis.__configOfSomePackage?.post;
if (post) post(1);
globalThis.__hookOfSomeTool?.(2);
console.log(globalThis.__configOfSomePackage === undefined, typeof globalThis.__hookOfSomeTool, "__hookOfSomeTool" in globalThis, Object.hasOwn(globalThis, "__configOfSomePackage"));
