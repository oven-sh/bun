function put(list) { list[1] = 7; }
put(Bun.argv);
const [, second] = process.argv;
console.log(typeof second, second?.length, JSON.stringify([second]), second + 1);
