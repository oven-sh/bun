const buffer = Buffer.from("héllo");
console.log(buffer.length + 1, buffer[0] + 1, buffer[99] === undefined, buffer.toString().length, buffer.toString("hex").length, buffer.toString("base64"));
