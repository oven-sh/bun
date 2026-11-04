namespace N { export let f: any; for ([f = () => {}] of [[]]) ; }
console.log(JSON.stringify(Object.keys(N).map(key => key + ":" + (N as any)[key].name)));
export {};
