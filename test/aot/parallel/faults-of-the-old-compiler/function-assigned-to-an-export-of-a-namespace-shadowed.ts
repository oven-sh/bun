namespace N { export let f: any = { name: "outer" }; export const seen = (() => { let f: any; f = () => {}; return f; })(); }
console.log(JSON.stringify(Object.keys(N).map(key => key + ":" + (N as any)[key].name)));
export {};
