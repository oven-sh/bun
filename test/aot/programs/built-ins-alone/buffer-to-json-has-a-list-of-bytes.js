const data = Buffer.from("ab").toJSON();
console.log(data.type, data.data.length, data.data[1] + 1);
