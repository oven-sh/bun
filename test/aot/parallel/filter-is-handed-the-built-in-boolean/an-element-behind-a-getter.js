const list = JSON.parse('[1,0,2]'); let reads = 0;
Object.defineProperty(list, 1, { get() { reads++; return 'got'; }, enumerable: true, configurable: true });
console.log(JSON.stringify(list.filter(Boolean)), reads);
