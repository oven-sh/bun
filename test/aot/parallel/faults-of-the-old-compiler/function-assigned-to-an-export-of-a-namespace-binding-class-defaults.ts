namespace N { export const [s = class {}]: any[] = []; export const { t = class {} }: any = {}; }
console.log(JSON.stringify(Object.keys(N).map(key => key + ":" + (N as any)[key].name)));
export {};
