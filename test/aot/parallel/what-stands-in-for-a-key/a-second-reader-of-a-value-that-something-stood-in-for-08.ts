function f(list: number[], t: any) { var key: any; const seen: any[] = []; try { for (key in list) delete t[key]; } catch { seen.push(key, typeof key); } return seen; }
console.log(JSON.stringify(f(JSON.parse("[7,8]"), Object.freeze({ 1: 2 })))); export {};
