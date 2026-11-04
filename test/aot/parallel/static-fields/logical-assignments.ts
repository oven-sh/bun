class Lazy { static cache: number[] | undefined = undefined; static hits = 0; }
function get(times: number) { let t = 0; for (let i = 0; i < times; i++) { Lazy.cache ??= [i + 1]; Lazy.hits ||= 7; t += Lazy.cache[0] + Lazy.hits; } return t; }
console.log(get(4));
export {};
