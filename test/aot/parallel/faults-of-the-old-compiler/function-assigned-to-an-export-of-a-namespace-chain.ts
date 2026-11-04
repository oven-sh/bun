namespace N { export let f: any; export let g: any; let h: any; h = f = g = () => {}; export const seen = h; }
console.log(JSON.stringify(Object.keys(N).map(key => key + ":" + (N as any)[key].name)));
export {};
