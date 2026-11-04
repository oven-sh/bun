namespace N { export let f: () => void; f = () => {}; }
console.log(JSON.stringify(N.f.name));
export {};
