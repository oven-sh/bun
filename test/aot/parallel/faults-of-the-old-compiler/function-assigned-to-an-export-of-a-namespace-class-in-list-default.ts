namespace N { export let e: any; [e = class {}] = []; }
console.log(JSON.stringify(Object.keys(N).map(key => key + ":" + (N as any)[key].name)));
export {};
