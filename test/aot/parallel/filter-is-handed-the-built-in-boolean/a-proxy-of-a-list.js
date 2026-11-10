const seen = []; const proxy = new Proxy(JSON.parse('[0,1,2]'), { get(target, key, receiver) { seen.push(String(key)); return Reflect.get(target, key, receiver); } });
console.log(JSON.stringify(proxy.filter(Boolean)), seen.join());
