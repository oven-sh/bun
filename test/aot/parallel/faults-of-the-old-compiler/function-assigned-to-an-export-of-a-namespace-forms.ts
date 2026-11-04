namespace N {
  export let a: any; a = () => {};
  export let b: any; b ??= () => {};
  export let c: any; c ||= () => {};
  export let d: any = 1; d &&= () => {};
  export let e: any; [e = () => {}] = [];
  export let f: any; ({ f = () => {} } = {} as any);
  export let g: any; g = class {};
  export let h: any; h = function () {};
  export let i: any = () => {};
  let j: any; j = () => {}; export const k = j;
  export let l: any; ({ x: l = () => {} } = {} as any);
}
(N as any).m = () => {};
console.log(JSON.stringify(Object.keys(N).map(key => key + ":" + (N as any)[key].name)));
export {};
