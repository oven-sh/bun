namespace N { export let f: any; namespace M { f = () => {}; } }
console.log(JSON.stringify(Object.keys(N).map(key => key + ":" + (N as any)[key].name)));
export {};
