import(Buffer.from("Li93YXRjaGVyLm1qcw==", "base64").toString()).then(() => console.log("x: loaded"), error => console.log("x rejected", error.constructor.name));
await new Promise(resolve => setTimeout(resolve, 5));
console.log("x goes on");
