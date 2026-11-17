function Ring() { this.size = 0; }
Ring.prototype.put = function (at, value) { this[at] = value; this.size++; };
const numbers = JSON.parse('[0, 1000, -0, 1.5, 1e21, 1e-7, -1, 4294967295]');
const ring = new Ring();
for (let i = 0; i < numbers.length; i++) ring.put(numbers[i], () => 'n' + i);
ring.put(Infinity, () => 'inf');
ring.put(NaN, () => 'nan');
const said = [ring['0'](), ring['1000'](), ring['1.5'](), ring['1e+21'](), ring['1e-7'](), ring['-1'](), ring['4294967295'](), ring.Infinity(), ring.NaN()];
const made = [String(numbers[3]), `${numbers[1]}`, '' + numbers[5], { [Symbol.toPrimitive]() { return '1.5'; } }];
for (const key of made) said.push(ring[key]());
said.push(typeof ring['1e3'], typeof ring['-0'], typeof ring['01'], ring.size);
console.log(said.join());
