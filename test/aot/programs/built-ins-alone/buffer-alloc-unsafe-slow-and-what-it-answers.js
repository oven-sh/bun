const result = Buffer.allocUnsafeSlow(1.5);
console.log(result instanceof Buffer, result.length, typeof result[0]);
