const numbers = JSON.parse('[0.5,0,2.5,-0.0,3.5]'); numbers.push(NaN, -0, Infinity);
console.log(numbers.filter(Boolean).join());
