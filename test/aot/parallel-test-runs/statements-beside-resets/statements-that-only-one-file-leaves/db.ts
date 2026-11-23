const url = (globalThis as any).url;
console.log("the database runs", url);
export const get = () => url;
export const name = () => url;
