const found = Object.entries(Object.getOwnPropertyDescriptors(JSON)).filter(([name]) => name === "stringify")[0][1].value;
console.log(found({ a: [1] }));
